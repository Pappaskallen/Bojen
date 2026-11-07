import { sv } from "@bojen/core/i18n/sv";

export default function HomePage() {
  return (
    <main>
      <h1>{sv.app.name}</h1>
      <p>{sv.app.tagline}</p>
    </main>
  );
}
