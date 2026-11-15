import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { safeNext } from "../_next";
import { PasskeySignIn } from "./passkey-sign-in";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: `${sv.signIn.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignInPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).nasta);
  return (
    <main className="booking">
      <h1>{sv.signIn.title}</h1>
      <p>{sv.signIn.intro}</p>
      <PasskeySignIn next={next} />
      <SignInForm next={next} />
    </main>
  );
}
