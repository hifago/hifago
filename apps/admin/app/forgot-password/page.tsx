import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { LogoHifago } from "@/components/logo-hifago";

export const metadata: Metadata = {
  title: "¿Olvidaste tu contraseña?",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <LogoHifago variante="clair" hauteur="h-16" />
      <h1 className="titre-page">¿Olvidaste tu contraseña?</h1>
      <ForgotPasswordForm />
    </main>
  );
}
