"use client";

import { BOAT_MAKES, ENGINE_MAKES } from "@bojen/core/catalog";
import { sv } from "@bojen/core/i18n/sv";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

const t = sv.booking;

type Mode = "water" | "land" | "indoor";

export interface WizardProps {
  firm: {
    slug: string;
    name: string;
    color: string | null;
    logoUrl: string | null;
    calloutPriceOre: number | null;
  };
  services: {
    id: string;
    name: string;
    durationMinutes: number;
    requiredMode: Mode | null;
    priceOre: number | null;
  }[];
  places: { id: string; name: string }[];
  initialPlaceId: string | null;
  initialServiceId: string | null;
  /** Inside the widget's iframe: no page header, and the height is sent to the parent. */
  embed: boolean;
  today: string;
}

interface Boat {
  id: string;
  label: string;
  locationId: string | null;
  mode: Mode | null;
}

interface Suggestion {
  mechanicId: string;
  day: string;
  label: string;
  start: string;
  marinaDay: boolean;
  discount: { kind: "waive_callout" } | { kind: "percent"; percent: number } | null;
}

interface Address {
  label: string;
  position: { lng: number; lat: number };
}

const STEPS = [
  t.steps.service,
  t.steps.boat,
  t.steps.place,
  t.steps.time,
  t.steps.photos,
  t.steps.confirm,
];
const MAX_BYTES = 8 * 1024 * 1024;

const dayFormat = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Stockholm",
});
const formatDay = (day: string) => {
  const text = dayFormat.format(new Date(`${day}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * A random key for the booking request. `crypto.randomUUID` only exists in secure contexts,
 * and the widget may sit on a mechanic's site served over plain http.
 */
function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}

export function BookingWizard(props: WizardProps) {
  const api = `/api/boka/${props.firm.slug}`;
  const [step, setStep] = useState(props.initialServiceId ? 1 : 0);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(newKey);

  // Step 1: service
  const [serviceId, setServiceId] = useState(props.initialServiceId ?? "");
  const service = props.services.find((s) => s.id === serviceId);

  // Step 2: customer and boat
  const [who, setWho] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [boatId, setBoatId] = useState<string>("");
  const [boat, setBoat] = useState({
    name: "",
    make: "",
    model: "",
    engineMake: "",
    engineModel: "",
    engineHours: "",
  });
  const knownBoat = boats.find((b) => b.id === boatId);
  const needsBoatForm = who === "new" || boatId === "other";

  // Step 3: place and mode
  const [placeKind, setPlaceKind] = useState<"marina" | "address">("marina");
  const [placeId, setPlaceId] = useState(props.initialPlaceId ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Address[] | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [mode, setMode] = useState<Mode | "">("");
  const [changeDate, setChangeDate] = useState("");
  const required = service?.requiredMode ?? null;
  const needsChange =
    (required === "land" && mode === "water") ||
    (required === "water" && (mode === "land" || mode === "indoor"));
  const placeName =
    placeKind === "marina"
      ? (props.places.find((p) => p.id === placeId)?.name ?? "")
      : (address?.label ?? "");

  // Step 4: time
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);

  // Step 5: photos
  const [photos, setPhotos] = useState<File[]>([]);
  const [notes, setNotes] = useState("");

  // Step 6: result
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.embed || !root.current || typeof ResizeObserver === "undefined") return;
    const node = root.current;
    const observer = new ResizeObserver(() => {
      window.parent.postMessage({ type: "bojen:height", height: node.scrollHeight + 32 }, "*");
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.embed]);

  // Prefill the place from the signed-in customer's boat.
  useEffect(() => {
    if (knownBoat?.locationId && props.places.some((p) => p.id === knownBoat.locationId)) {
      setPlaceKind("marina");
      setPlaceId(knownBoat.locationId);
    }
    if (knownBoat?.mode) setMode(knownBoat.mode);
  }, [knownBoat, props.places]);

  async function post(path: string, body: unknown) {
    return fetch(`${api}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function sendCode() {
    setError(null);
    const response = await post("code", { phone });
    if (response.status === 400) return setError(t.errors.phone);
    if (!response.ok) return setError(t.confirm.failed);
    setCodeSent(true);
  }

  async function verify() {
    setError(null);
    const response = await post("verify", { phone, code });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      return setError(body.detail === "expired" ? t.boat.expiredCode : t.boat.wrongCode);
    }
    const body = (await response.json()) as { token: string; boats: Boat[] };
    setToken(body.token);
    setBoats(body.boats);
    setBoatId(body.boats[0]?.id ?? "other");
  }

  async function searchAddress(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`${api}/address?q=${encodeURIComponent(query)}`);
    const body = (await response.json().catch(() => ({ results: [] }))) as { results: Address[] };
    setResults(body.results);
  }

  async function loadSuggestions() {
    setSuggestions(null);
    setChosen(null);
    const response = await post("suggestions", {
      serviceTypeId: serviceId,
      place: placeKind === "marina" ? { locationId: placeId } : { position: address?.position },
      mode,
      changeDate: needsChange ? changeDate : null,
    });
    const body = (await response.json().catch(() => ({ suggestions: [] }))) as {
      suggestions?: Suggestion[];
    };
    setSuggestions(body.suggestions ?? []);
  }

  function validate(): string | null {
    switch (step) {
      case 0:
        return service ? null : t.errors.required;
      case 1:
        if (who === "existing" && !token) return t.errors.required;
        if (who === "new" && (!name.trim() || !phone.trim())) return t.errors.required;
        if (needsBoatForm && !boat.make.trim()) return t.errors.required;
        return null;
      case 2:
        if (placeKind === "marina" ? !placeId : !address) return t.errors.required;
        if (!mode) return t.errors.required;
        if (needsChange && !changeDate) return t.errors.required;
        return null;
      case 3:
        return chosen === null ? t.errors.required : null;
      case 4:
        return photos.some((p) => p.size > MAX_BYTES) ? t.photos.tooLarge : null;
      default:
        return null;
    }
  }

  function next() {
    const problem = validate();
    setError(problem);
    if (problem) return;
    if (step === 2) void loadSuggestions();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function submit() {
    const pick = chosen === null ? undefined : suggestions?.[chosen];
    if (!pick) return;
    setSending(true);
    setError(null);
    const data = {
      serviceTypeId: serviceId,
      mechanicId: pick.mechanicId,
      start: pick.start,
      customer: token ? { signedIn: true } : { name, phone, email },
      boat: needsBoatForm
        ? { ...boat, engineHours: boat.engineHours ? Number(boat.engineHours) : null }
        : { id: boatId },
      place: placeKind === "marina" ? { locationId: placeId } : address,
      mode,
      changeDate: needsChange ? changeDate : null,
      notes,
    };
    const form = new FormData();
    form.set("data", JSON.stringify(data));
    for (const photo of photos) form.append("photos", photo);
    const headers: Record<string, string> = { "idempotency-key": idempotencyKey };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${api}/book`, { method: "POST", body: form, headers }).catch(
      () => null,
    );
    setSending(false);
    if (response?.status === 201) {
      const body = (await response.json()) as { visit: { status: string } };
      setDone(body.visit.status === "pending_approval" ? t.confirm.pending : t.confirm.booked);
      return;
    }
    const body = (await response?.json().catch(() => ({}))) as { detail?: string } | undefined;
    if (body?.detail === "already_customer") {
      setWho("existing");
      setStep(1);
      setError(t.boat.alreadyCustomer);
    } else if (response?.status === 409) {
      setStep(3);
      setError(t.confirm.taken);
      void loadSuggestions();
    } else {
      setError(t.confirm.failed);
    }
  }

  const style = props.firm.color
    ? ({ "--brand": props.firm.color } as React.CSSProperties)
    : undefined;

  return (
    <div className={props.embed ? "booking embed" : "booking"} style={style} ref={root}>
      {props.embed ? null : (
        <header className="firm">
          {props.firm.logoUrl ? (
            // The firm's own small logo from its own site; next/image would need every host listed.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.firm.logoUrl} alt="" width={40} height={40} />
          ) : null}
          <h1>{t.title(props.firm.name)}</h1>
        </header>
      )}

      {done ? (
        <section aria-live="polite" className="done">
          <h2>{t.steps.confirm}</h2>
          <p>{done}</p>
        </section>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step === STEPS.length - 1) void submit();
            else next();
          }}
          noValidate
        >
          <p className="progress">
            {t.stepOf(step + 1, STEPS.length)} · {STEPS[step]}
          </p>

          {step === 0 ? (
            <fieldset>
              <legend>{t.service.heading}</legend>
              {props.services.map((s) => (
                <label key={s.id} className="choice">
                  <input
                    type="radio"
                    name="service"
                    value={s.id}
                    checked={serviceId === s.id}
                    onChange={() => setServiceId(s.id)}
                  />
                  <span>
                    <strong>{s.name}</strong>
                    <small>
                      {t.service.duration(s.durationMinutes)}
                      {s.priceOre ? ` · ${t.service.price(s.priceOre)}` : ""}
                      {s.requiredMode === "land" ? ` · ${t.service.needsLand}` : ""}
                      {s.requiredMode === "water" ? ` · ${t.service.needsWater}` : ""}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {step === 1 ? (
            <fieldset>
              <legend>{t.boat.heading}</legend>
              <div className="toggle">
                <label className="choice">
                  <input
                    type="radio"
                    name="who"
                    checked={who === "new"}
                    onChange={() => setWho("new")}
                  />
                  <span>{t.boat.newCustomer}</span>
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="who"
                    checked={who === "existing"}
                    onChange={() => setWho("existing")}
                  />
                  <span>{t.boat.existingCustomer}</span>
                </label>
              </div>

              {who === "new" ? (
                <>
                  <Field label={t.boat.name}>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </Field>
                  <Field label={t.boat.phone}>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      required
                    />
                  </Field>
                  <Field label={t.boat.email}>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      autoComplete="email"
                    />
                  </Field>
                </>
              ) : token ? (
                <Field label={t.boat.chooseBoat}>
                  <select value={boatId} onChange={(e) => setBoatId(e.target.value)}>
                    {boats.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                    <option value="other">{t.boat.otherBoat}</option>
                  </select>
                </Field>
              ) : (
                <>
                  <Field label={t.boat.phone}>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </Field>
                  <button type="button" className="secondary" onClick={() => void sendCode()}>
                    {t.boat.sendCode}
                  </button>
                  {codeSent ? (
                    <>
                      <p aria-live="polite">{t.boat.codeSent}</p>
                      <Field label={t.boat.code}>
                        <input
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                        />
                      </Field>
                      <button type="button" className="secondary" onClick={() => void verify()}>
                        {t.boat.verify}
                      </button>
                    </>
                  ) : null}
                </>
              )}

              {needsBoatForm && (who === "new" || token) ? (
                <div className="group">
                  <Field label={t.boat.boatName}>
                    <input
                      value={boat.name}
                      onChange={(e) => setBoat({ ...boat, name: e.target.value })}
                    />
                  </Field>
                  <Field label={t.boat.make}>
                    <input
                      value={boat.make}
                      onChange={(e) => setBoat({ ...boat, make: e.target.value })}
                      list="boat-makes"
                      required
                    />
                  </Field>
                  <Field label={t.boat.model}>
                    <input
                      value={boat.model}
                      onChange={(e) => setBoat({ ...boat, model: e.target.value })}
                    />
                  </Field>
                  <Field label={t.boat.engineMake}>
                    <input
                      value={boat.engineMake}
                      onChange={(e) => setBoat({ ...boat, engineMake: e.target.value })}
                      list="engine-makes"
                    />
                  </Field>
                  <Field label={t.boat.engineModel}>
                    <input
                      value={boat.engineModel}
                      onChange={(e) => setBoat({ ...boat, engineModel: e.target.value })}
                    />
                  </Field>
                  <Field label={t.boat.engineHours}>
                    <input
                      value={boat.engineHours}
                      onChange={(e) =>
                        setBoat({ ...boat, engineHours: e.target.value.replace(/\D/g, "") })
                      }
                      inputMode="numeric"
                    />
                  </Field>
                  <datalist id="boat-makes">
                    {BOAT_MAKES.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <datalist id="engine-makes">
                    {ENGINE_MAKES.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {step === 2 ? (
            <fieldset>
              <legend>{t.place.heading}</legend>
              <div className="toggle">
                <label className="choice">
                  <input
                    type="radio"
                    name="placeKind"
                    checked={placeKind === "marina"}
                    onChange={() => setPlaceKind("marina")}
                  />
                  <span>{t.place.marina}</span>
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="placeKind"
                    checked={placeKind === "address"}
                    onChange={() => setPlaceKind("address")}
                  />
                  <span>{t.place.otherAddress}</span>
                </label>
              </div>
              {placeKind === "marina" ? (
                <Field label={t.place.chooseMarina}>
                  <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
                    <option value="">–</option>
                    {props.places.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <div className="group">
                  <Field label={t.place.address}>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void searchAddress(e);
                      }}
                      autoComplete="street-address"
                    />
                  </Field>
                  <button
                    type="button"
                    className="secondary"
                    onClick={(e) => void searchAddress(e)}
                  >
                    {t.place.address}
                  </button>
                  {results?.length === 0 ? <p>{t.place.noAddress}</p> : null}
                  {results?.map((r) => (
                    <label key={r.label} className="choice">
                      <input
                        type="radio"
                        name="address"
                        checked={address?.label === r.label}
                        onChange={() => setAddress(r)}
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              )}

              <fieldset className="group">
                <legend>{t.place.mode}</legend>
                {(["water", "land", "indoor"] as const).map((m) => (
                  <label key={m} className="choice">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    <span>{t.place[m]}</span>
                  </label>
                ))}
              </fieldset>
              {needsChange ? (
                <Field label={required === "land" ? t.place.haulOut : t.place.launch}>
                  <input
                    type="date"
                    value={changeDate}
                    min={props.today}
                    onChange={(e) => setChangeDate(e.target.value)}
                    required
                  />
                </Field>
              ) : null}
            </fieldset>
          ) : null}

          {step === 3 ? (
            <fieldset aria-busy={suggestions === null}>
              <legend>{t.time.heading}</legend>
              {suggestions === null ? <p aria-live="polite">{t.time.loading}</p> : null}
              {suggestions?.length === 0 ? <p>{t.time.none}</p> : null}
              {suggestions?.map((s, i) => (
                <label
                  key={s.start + s.mechanicId}
                  className={s.marinaDay ? "choice marina" : "choice"}
                >
                  <input
                    type="radio"
                    name="time"
                    checked={chosen === i}
                    onChange={() => setChosen(i)}
                  />
                  <span>
                    <strong>
                      {formatDay(s.day)}, {t.time.window(s.label)}
                    </strong>
                    {s.marinaDay ? (
                      <small className="badge">
                        {t.time.marinaDay(placeName)}
                        {s.discount?.kind === "waive_callout"
                          ? `, ${t.time.calloutWaived(props.firm.calloutPriceOre)}`
                          : s.discount?.kind === "percent"
                            ? `, ${t.time.percentOff(s.discount.percent)}`
                            : ""}
                      </small>
                    ) : null}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {step === 4 ? (
            <fieldset>
              <legend>{t.photos.heading}</legend>
              <p>{t.photos.help}</p>
              <Field label={t.photos.add}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  multiple
                  onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))}
                />
              </Field>
              <Field label={t.photos.notes}>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </Field>
            </fieldset>
          ) : null}

          {step === 5 ? (
            <section>
              <h2>{t.confirm.heading}</h2>
              <dl className="summary">
                <dt>{t.steps.service}</dt>
                <dd>{service?.name}</dd>
                <dt>{t.steps.boat}</dt>
                <dd>
                  {needsBoatForm
                    ? [boat.name, boat.make, boat.model].filter(Boolean).join(" ")
                    : knownBoat?.label}
                </dd>
                <dt>{t.steps.place}</dt>
                <dd>
                  {placeName} · {mode ? t.place[mode] : ""}
                </dd>
                <dt>{t.steps.time}</dt>
                <dd>
                  {chosen !== null && suggestions?.[chosen]
                    ? `${formatDay(suggestions[chosen].day)}, ${t.time.window(suggestions[chosen].label)}`
                    : ""}
                </dd>
              </dl>
            </section>
          ) : null}

          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}

          <div className="actions">
            {step > 0 ? (
              <button type="button" className="secondary" onClick={() => setStep((s) => s - 1)}>
                {t.back}
              </button>
            ) : (
              <span />
            )}
            <button type="submit" disabled={sending}>
              {step === STEPS.length - 1
                ? sending
                  ? t.confirm.sending
                  : t.confirm.submit
                : t.next}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
