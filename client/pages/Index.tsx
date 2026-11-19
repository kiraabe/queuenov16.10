import { Navigate } from "react-router-dom";
import Hero from "@/components/home/Hero";
import WorkflowPhases from "@/components/home/WorkflowPhases";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/hooks/use-translation";
import { homePathForUser } from "@/lib/role-home";

// Live system stats are computed from SSE init + updates

const QR_MATRIX = [
  "1111110",
  "1000001",
  "1011101",
  "1010101",
  "1011101",
  "1000001",
  "0111111",
];

const SampleQRCode = () => (
  <div className="grid grid-cols-7 gap-1 rounded-2xl bg-white p-3 shadow-inner shadow-primary/10">
    {QR_MATRIX.flatMap((row, rowIndex) =>
      row
        .split("")
        .map((cell, cellIndex) => (
          <span
            key={`${rowIndex}-${cellIndex}`}
            className={cn(
              "h-2 w-2 rounded-[2px] md:h-3 md:w-3",
              cell === "1" ? "bg-foreground" : "bg-muted",
            )}
          />
        )),
    )}
  </div>
);

const TicketSnapshot = ({ t }: { t: (key: string) => string }) => (
  <div className="relative rounded-3xl border border-border/70 bg-card/90 p-6 shadow-xl shadow-primary/10 backdrop-blur">
    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
      <span>{t("home.virtualTicket")}</span>
      <span>{t("home.window")} 3</span>
    </div>
    <div className="mt-4 flex flex-col gap-6 rounded-2xl bg-background/80 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t("home.ticketNumber")}
          </p>
          <p className="font-display text-4xl font-semibold text-foreground">
            015
          </p>
          <p className="text-sm text-muted-foreground">
            {t("home.service")}
          </p>
        </div>
        <SampleQRCode />
      </div>
      <div className="grid gap-3 text-sm">
        <div className="flex items-center justify-between rounded-2xl bg-secondary/60 px-4 py-3">
          <span className="font-medium text-secondary-foreground">
            {t("home.position")}
          </span>
          <span className="font-display text-lg text-foreground">#4</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-accent/60 px-4 py-3">
          <span className="font-medium text-accent-foreground">
            {t("home.estWait")}
          </span>
          <span className="font-display text-lg text-foreground">
            07:45 min
          </span>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-primary/10 px-4 py-3 text-sm">
          <span className="font-medium text-primary">{t("home.status")}</span>
          <span className="font-display text-base text-primary">
            {t("home.statusText")}
          </span>
        </div>
      </div>
    </div>
    <div className="mt-6 rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>{t("home.nowServing")}</span>
        <span>{t("home.updated")}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm font-semibold text-foreground">
        <div className="rounded-xl bg-primary/10 px-4 py-3">
          <p className="text-xs uppercase text-muted-foreground">{t("home.window")} 1</p>
          <p className="font-display text-lg">012</p>
        </div>
        <div className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">
          <p className="text-xs uppercase text-primary-foreground/70">
            {t("home.window")} 2
          </p>
          <p className="font-display text-lg">013</p>
        </div>
        <div className="rounded-xl bg-primary/10 px-4 py-3">
          <p className="text-xs uppercase text-muted-foreground">{t("home.window")} 3</p>
          <p className="font-display text-lg">014</p>
        </div>
      </div>
    </div>
  </div>
);

export default function Index() {
  const { user } = useAuth();
  const { t } = useTranslation();

  // Wait for auth to load
  if (user === undefined) return null;

  const home = user ? homePathForUser(user) : null;
  if (home) return <Navigate to={home} replace />;


  return (
    <div className="relative overflow-visible">
      <Hero />

      <section
        id="features"
        className="relative border-t border-border/60 bg-foreground/5 py-8 sm:py-12 md:py-16"
      >
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-foreground">
              {t("home.coreFeatures")}
            </h2>
            <p className="mt-1 sm:mt-2 text-sm text-muted-foreground max-w-2xl">
              {t("home.featuresSubtitle")}
            </p>
          </div>

          <div className="mt-6 sm:mt-8 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-card/90 p-4 sm:p-5 hover:bg-card/95 transition-colors">
              <h3 className="text-sm sm:text-base font-semibold text-foreground">
                {t("home.feat1Title")}
              </h3>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {t("home.feat1Desc")}
              </p>
            </div>

            <div className="rounded-lg border border-border/60 bg-card/90 p-4 sm:p-5 hover:bg-card/95 transition-colors">
              <h3 className="text-sm sm:text-base font-semibold text-foreground">
                {t("home.feat2Title")}
              </h3>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {t("home.feat2Desc")}
              </p>
            </div>

            <div className="rounded-lg border border-border/60 bg-card/90 p-4 sm:p-5 hover:bg-card/95 transition-colors">
              <h3 className="text-sm sm:text-base font-semibold text-foreground">
                {t("home.feat3Title")}
              </h3>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {t("home.feat3Desc")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <WorkflowPhases />
    </div>
  );
}
