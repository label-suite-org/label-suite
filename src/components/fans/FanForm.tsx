import { useState } from "react";
import type { PublishedDrop } from "../../server/fan-drops-core";

type Props = { action: "signup"; org: string; slug: string; revision: number; page: PublishedDrop; enabled: boolean }
  | { action: "confirm" | "unsubscribe"; token: string };
export function FanForm(props: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState<string | null>(null);
  const [next, setNext] = useState<{ url: string; label: string } | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = props.action === "signup" ? { org: props.org, slug: props.slug, signup: {
      email: form.get("email"), name: form.get("name"), city: form.get("city"), consent: form.get("consent") === "on",
      show_id: form.get("show_id") || null, published_revision: props.revision, website: form.get("website"),
    } } : { token: props.token };
    setBusy(true); setError(false); setMessage("");
    try {
      const response = await fetch(`/api/fans/${props.action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We could not complete this request. Try again.");
      setMessage(props.action === "signup" ? result.message : props.action === "confirm" ? "Your email is confirmed. You're on the list." : "You’re unsubscribed from this artist’s email updates.");
      if (props.action === "confirm" && typeof result.success_url === "string" && result.success_url.startsWith("https://")) setNext({ url: result.success_url, label: result.success_label });
      if (props.action === "confirm" && typeof result.unsubscribe_url === "string" && new URL(result.unsubscribe_url).origin === location.origin) setUnsubscribe(result.unsubscribe_url);
      setDone(true);
    } catch (failure) { setError(true); setMessage(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <form method="post" action={`/api/fans/${props.action}`} onSubmit={submit} className="fan-form">
    <noscript>Please enable JavaScript to use this signup form.</noscript>
    {!done && <>
      {props.action === "signup" && <>
        <label>Email address <input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label>Name <span>(optional)</span><input name="name" autoComplete="name" maxLength={150} /></label>
        <label>City <span>(optional)</span><input name="city" autoComplete="address-level2" maxLength={100} /></label>
        {!!props.page.shows.length && <label>Your show <select name="show_id"><option value="">General updates</option>{props.page.shows.map(show => <option key={show.id} value={show.id}>{[show.city, show.title].filter(Boolean).join(" · ")}</option>)}</select></label>}
        <div className="fan-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <label className="fan-consent"><input name="consent" type="checkbox" required /><span>{props.page.consent_text}</span></label>
        <p className="fan-small">Read the <a href={props.page.privacy_url} target="_blank" rel="noreferrer">privacy policy</a>. We’ll email a link to confirm your signup.</p>
      </>}
      <button disabled={busy || (props.action === "signup" && !props.enabled)} type="submit">{busy ? "Please wait…" : props.action === "signup" ? "Sign up for updates" : props.action === "confirm" ? "Confirm my email" : "Unsubscribe"}</button>
      {props.action === "signup" && !props.enabled && <p>Signups aren’t open yet. Please check back soon.</p>}
    </>}
    <p role={error ? "alert" : "status"} aria-live="polite">{message}</p>
    {unsubscribe && <p className="fan-small"><a href={unsubscribe}>Unsubscribe from this artist</a></p>}
    {next && <a className="fan-next" href={next.url} rel="noreferrer">{next.label}</a>}
  </form>;
}
