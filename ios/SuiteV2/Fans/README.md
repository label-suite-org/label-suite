# Suite-v2 Fans & Drops integration

These are the canonical new Swift sources for the existing Suite-v2 application. The older `ios/LabelSuite` package is a separate native shell; do not mix its API/session types with Suite-v2.

Copy the four `BackendFan*.swift` files into the existing Suite-v2 target's filesystem-synchronized source folder. Apply `integration.patch` at the Suite-v2 project root to add one client method, one session-checked store method and the Fans & Drops navigation link. The patch intentionally excludes unrelated local native work. Inspect the context before applying it to a newer version; do not overwrite the client's existing methods or session checks.

`FanModelsCheck.swift` is a standalone check, **not** an app source file:

```sh
xcrun swiftc -parse-as-library BackendFanModels.swift FanModelsCheck.swift -o /tmp/fan-models-check
/tmp/fan-models-check
```

Build the existing Suite-v2 scheme for an iOS simulator. Use a disposable local backend to exercise the full workflow. Server permission and activation gates remain authoritative. The app does not cache fan addresses; views discard their state on workspace changes. Draft Drop/message editors protect unsaved changes and use the saved revision for commands. Sharing and export open the system share sheet and require the operator's action.

A successful simulator compilation is not physical-device or live-provider acceptance. See `docs/features/fans-and-drops.md` in the repository for the bounded rollout and recovery procedure.


Owner-only pilot: use the main authenticated BackendSessionStore for the Library → Fans & Drops link. Do not switch the live tour session to the disposable FanPilotView. The home response supplies `allowed_email` and `test_recipient`; the native UI shows the restriction and enables Send test to me only for the configured owner. Test copies are separate messages and do not replace the editable draft. Optional response fields preserve compatibility with older servers. The shared app must include other chats' latest source and preserve its container/keychain during in-place installation.
