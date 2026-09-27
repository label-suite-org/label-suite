"""
Simple async event bus: priority-ordered subscribers with dead-object cleanup.

Subscribers are wrapped in weakrefs where possible so that when an object
(bound method owner) is garbage-collected, its subscription is automatically
pruned during the next emit. Plain functions (module-level) are stored
directly — they live forever anyway.

Usage:
    bus = EventBus()

    class Player:
        async def on_damage(self, amount, source):
            print(f"Took {amount} from {source}")

    player = Player()
    bus.subscribe("damage", player.on_damage, priority=10)
    await bus.emit("damage", amount=5, source="goblin")
    del player          # subscriber cleaned up on next emit
    await bus.emit("damage", amount=3, source="trap")  # player.on_damage skipped
"""

import asyncio
import types
import weakref
from collections import defaultdict
from collections.abc import Callable
from typing import Any, Union


# ── weakref helpers ────────────────────────────────────────────────────────

Ref = Union[weakref.ReferenceType, "tuple[weakref.ReferenceType, str]", Callable[..., Any]]


def _wrap(cb: Callable[..., Any]) -> Ref:
    """Store a callback so it can be automatically cleaned up when its owner dies."""
    # Bound methods: store (weakref to instance, method name) so the instance
    # can be collected — a bare weakref.ref(bound_method) keeps self alive.
    if isinstance(cb, types.MethodType):
        return (weakref.ref(cb.__self__), cb.__func__.__name__)
    try:
        return weakref.ref(cb)          # __call__ instances, closures, lambdas
    except TypeError:
        return cb                        # module-level functions (immortal)


def _unwrap(ref: Ref) -> Union[Callable[..., Any], None]:
    """Resolve a stored callback reference back to a live callable, or None."""
    if isinstance(ref, tuple):          # (weakref_to_instance, method_name)
        obj = ref[0]()
        return getattr(obj, ref[1]) if obj is not None else None
    if isinstance(ref, weakref.ReferenceType):
        return ref()
    return ref                          # plain function


# ── the bus ─────────────────────────────────────────────────────────────────

class EventBus:
    """Async event bus with priority dispatch and automatic dead-sub cleanup."""

    def __init__(self):
        self._subs: dict[str, list[tuple[int, Ref]]] = defaultdict(list)

    # -- registration --------------------------------------------------------

    def subscribe(self, event: str, cb, priority: int = 0) -> None:
        """Register *cb* for *event*.  Higher ``priority`` fires first."""
        self._subs[event].append((priority, _wrap(cb)))
        self._subs[event].sort(key=lambda item: -item[0])

    def unsubscribe(self, event: str, cb) -> None:
        """Remove an explicit callback from *event*."""
        self._subs[event] = [
            (p, r) for p, r in self._subs.get(event, [])
            if _unwrap(r) is not cb
        ]

    # -- dispatch ------------------------------------------------------------

    async def emit(self, event: str, **kwargs) -> None:
        """Fire *event*, calling every subscriber (highest priority first).

        Dead weak references are pruned during emission.  Sync subscribers
        run inline; async subscribers are awaited.
        """
        subs = self._subs.get(event)
        if not subs:
            return
        alive: list[tuple[int, object]] = []
        for prio, ref in subs:
            cb = _unwrap(ref)
            if cb is None:               # owner garbage-collected → skip
                continue
            alive.append((prio, ref))
            try:
                ret = cb(**kwargs)
                if asyncio.iscoroutine(ret):
                    await ret
            except Exception:
                pass                      # one bad subscriber doesn't break the bus
        if len(alive) != len(subs):       # something died — replace the list
            self._subs[event] = alive