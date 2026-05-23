import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Factory, FileText, Receipt, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { PrintersHeroSplashVideo } from "@/components/branding/PrintersHeroSplashVideo";
import { SHIELD_LOGO_SRC, SPLASH_STATIC_SRC } from "@/lib/branding";

export default function Landing() {
  const splashVideoRef = useRef<HTMLVideoElement>(null);
  const [videoEnded, setVideoEnded] = useState(false);

  const replayIntro = () => {
    const video = splashVideoRef.current;
    if (!video) return;

    setVideoEnded(false);
    video.currentTime = 0;
    void video.play().catch(() => {
      setVideoEnded(true);
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <img src={SHIELD_LOGO_SRC} alt="" className="h-8 w-8" aria-hidden="true" />
            <span className="text-sm font-semibold text-white drop-shadow-sm sm:text-base">
              Printers Hero
            </span>
          </div>
          <Button asChild variant="secondary" data-testid="button-login">
            <a href="/login">Sign In</a>
          </Button>
        </div>
      </header>

      <main>
        <section className="relative min-h-[92vh] overflow-hidden bg-slate-950">
          <img
            src={SPLASH_STATIC_SRC}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <PrintersHeroSplashVideo
            ref={splashVideoRef}
            fadeOut={videoEnded}
            onEnded={() => setVideoEnded(true)}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-black/45" />
          <div className="relative z-10 mx-auto flex min-h-[92vh] max-w-7xl flex-col justify-center px-4 pb-16 pt-28 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
                <img src={SHIELD_LOGO_SRC} alt="" className="h-4 w-4 invert" aria-hidden="true" />
                Print industry software platform
              </div>
              <h1
                className="text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl"
                data-testid="text-hero-title"
              >
                Print shop workflow from quote to invoice.
              </h1>
              <p
                className="mt-5 max-w-2xl text-base leading-7 text-white/85 sm:text-lg"
                data-testid="text-hero-description"
              >
                Printers Hero brings quoting, production, fulfillment, and billing into one
                connected operating system for modern print teams.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" asChild data-testid="button-get-started">
                  <a href="/login">
                    Sign In
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button size="lg" variant="secondary" asChild>
                  <a href="/support">Talk to Support</a>
                </Button>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={replayIntro}
            className="absolute bottom-5 right-5 z-20 border border-white/20 bg-white/10 text-white shadow-lg backdrop-blur transition hover:bg-white/20 sm:bottom-8 sm:right-8"
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Replay Intro
          </Button>
        </section>

        <section className="mx-auto grid max-w-7xl gap-4 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <Card data-testid="card-feature-quotes">
            <CardHeader>
              <FileText className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Quoting</CardTitle>
            </CardHeader>
            <CardContent>
              Build reusable product logic and turn clean quotes into real orders.
            </CardContent>
          </Card>

          <Card data-testid="card-feature-production">
            <CardHeader>
              <Factory className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Production</CardTitle>
            </CardHeader>
            <CardContent>
              Keep design, proofing, prepress, and production states in sync.
            </CardContent>
          </Card>

          <Card data-testid="card-feature-fulfillment">
            <CardHeader>
              <Truck className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Fulfillment</CardTitle>
            </CardHeader>
            <CardContent>
              Preserve pickup, delivery, and shipping details from order intake onward.
            </CardContent>
          </Card>

          <Card data-testid="card-feature-billing">
            <CardHeader>
              <Receipt className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Billing</CardTitle>
            </CardHeader>
            <CardContent>
              Move completed production into billing readiness without duplicate entry.
            </CardContent>
          </Card>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-xl font-semibold">Built for print workflow discipline.</h2>
                <p className="text-sm text-muted-foreground">
                  State transitions, snapshots, and production data stay connected.
                </p>
              </div>
            </div>
            <Button asChild>
              <a href="/login">Go to Login</a>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
