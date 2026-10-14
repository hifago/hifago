"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button, buttonVariants, Card, cn, Input, Label } from "@hifago/ui";
import { SUPPORT_WHATSAPP_NUMBER, buildWhatsAppLink, supportReferralCodeMessage } from "@/lib/whatsapp";

export function PartnerCodeEntry({ code, link }: { code: string; link: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Génération du QR CÔTÉ CLIENT (cahier des charges socio §3h) : SVG (vectoriel, impression) via
  // QRCode.toString + PNG (raster, web/WhatsApp) rendu sur un <canvas> via QRCode.toCanvas — les
  // deux formats sont exigés, pas un choix entre les deux. Le QR encode `link` (l'URL de
  // redirection /[locale]/r/[code]), jamais une URL finale construite à la main. width=240 explicite
  // (retour Jérôme, 2026-08-20 : présentation trop pauvre) — sans lui, la lib retombe sur une taille
  // "naturelle" liée au nombre de modules, trop petite pour rester lisible une fois posée dans une
  // carte avec du texte autour.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;

    QRCode.toString(link, { type: "svg", margin: 1, width: 240 }).then((svg) => {
      if (!cancelled) setSvgMarkup(svg);
    });
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, link, { margin: 1, width: 240 });
    }

    return () => {
      cancelled = true;
    };
  }, [link]);

  async function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function triggerDownload(href: string, filename: string) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
  }

  async function handleCopyCode() {
    await copyToClipboard(code, setCopiedCode);
  }

  async function handleCopyLink() {
    if (!link) return;
    await copyToClipboard(link, setCopiedLink);
  }

  function handleDownloadSvg() {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `hifago-${code}.svg`);
    URL.revokeObjectURL(url);
  }

  function handleDownloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    triggerDownload(canvas.toDataURL("image/png"), `hifago-${code}.png`);
  }

  const whatsappHref = buildWhatsAppLink(SUPPORT_WHATSAPP_NUMBER, supportReferralCodeMessage(code));

  return (
    <Card data-testid="partner-code-entry" className="w-full overflow-hidden">
      <Card.Header className="border-b border-border bg-surface-secondary/40">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Código de referido
            </span>
            <Card.Title className="text-2xl font-bold tracking-tight">{code}</Card.Title>
          </div>
        </div>
      </Card.Header>

      <Card.Content className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:gap-8">
        {/* QR bien encadré, marge blanche généreuse (lisibilité + zone de silence pour le scan) */}
        <div className="flex flex-col items-center gap-3 sm:shrink-0">
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <canvas ref={canvasRef} className="block" />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onPress={handleDownloadSvg}
              data-testid="download-svg-button"
            >
              SVG
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onPress={handleDownloadPng}
              data-testid="download-png-button"
            >
              PNG
            </Button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`code-${code}`}>Código</Label>
            <div className="flex gap-2">
              <Input
                id={`code-${code}`}
                readOnly
                fullWidth
                value={code}
                className="flex-1 font-mono"
                data-testid="partner-code-value"
              />
              <Button
                type="button"
                variant="outline"
                onPress={handleCopyCode}
                data-testid="copy-code-button"
              >
                {copiedCode ? "Copiado ✓" : "Copiar"}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`link-${code}`}>Enlace atribuido</Label>
            <div className="flex gap-2">
              <Input
                id={`link-${code}`}
                readOnly
                fullWidth
                value={link}
                className="flex-1 font-mono text-sm"
                data-testid="partner-link-value"
              />
              <Button
                type="button"
                variant="outline"
                onPress={handleCopyLink}
                data-testid="copy-link-button"
              >
                {copiedLink ? "Copiado ✓" : "Copiar"}
              </Button>
            </div>
          </div>

          <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-4">
            <p className="text-sm text-muted">¿Problemas con tu enlace o QR?</p>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="whatsapp-support-button"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full justify-center")}
            >
              Soporte por WhatsApp
            </a>
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}
