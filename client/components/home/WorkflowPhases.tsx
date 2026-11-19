import type { ReactNode } from "react";
import styles from "./WorkflowPhases.module.css";

type Step = { title: string; text: string };
type Phase = { title: string; tag?: string; description: string; icon: ReactNode; steps: Step[] };

const svg = (d: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const phases: Phase[] = [
  {
    title: "Reception / Case Manager",
    description:
      "A ticket is created with the selected service, a QR code is generated, and the ticket number is displayed to the customer.",
    icon: svg(
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4h6v3H9zM9 13l2 2 4-4" />
      </>
    ),
    steps: [
      { title: "Eligibility verification", text: "Verify customer service eligibility before creating a ticket." },
      { title: "Quick QR ticket issuance", text: "Generate QR-coded tickets with service type and estimated wait time." },
      { title: "Queue management", text: "Assign customers to appropriate service lines with real-time position tracking." },
      { title: "Customer notifications", text: "Send real-time updates via QR code scans when customer's turn approaches." },
    ],
  },
  {
    title: "Archiver / Documentation",
    description:
      "The archiver claims the ticket, fetches and verifies the required documents, and marks the case as ready.",
    icon: svg(
      <>
        <rect x="3" y="4" width="18" height="5" rx="1" />
        <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
      </>
    ),
    steps: [
      { title: "Document collection", text: "Gather all supporting documents and attachments for completed cases." },
      { title: "Compliance verification", text: "Verify that all required documents meet compliance standards and completeness." },
      { title: "Archive storage", text: "Securely store and organize archived documents for future retrieval." },
    ],
  },
  {
    title: "Teller / Service Delivery",
    description:
      "The teller calls the ticket, serves the customer, and documents the interaction.",
    icon: svg(
      <>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <rect x="3" y="14" width="4" height="6" rx="1.5" />
        <rect x="17" y="14" width="4" height="6" rx="1.5" />
      </>
    ),
    steps: [
      { title: "Real-time ticket calling", text: "Automatically call tickets in order with visual and audio alerts." },
      { title: "Case workflow tracking", text: "Document service interactions and capture outcomes in real-time." },
      { title: "Service analytics", text: "Track service times, customer satisfaction, and operational metrics." },
    ],
  },
  {
    title: "Employee / Back Office",
    tag: "Complex cases",
    description:
      "The employee works on the case, can transfer to another employee if needed, and completes the case.",
    icon: svg(
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
      </>
    ),
    steps: [
      { title: "Case assignment", text: "Receive transferred cases requiring detailed management and complex decision-making." },
      { title: "Workflow tracking", text: "Track case progress through multiple workflow stages with status updates." },
      { title: "Staff collaboration", text: "Transfer cases to other employees if specialized knowledge or further review is needed." },
      { title: "Case completion", text: "Mark cases as complete and initiate archival process for record-keeping." },
    ],
  },
];

export default function WorkflowPhases() {
  return (
    <section className={styles.section} aria-labelledby="workflow-phases-title">
      <div className={styles.inner}>
        <header className={styles.header}>
          <h2 id="workflow-phases-title" className={styles.heading}>Workflow Phases</h2>
          <p className={styles.sub}>
            Complete case management from reception through completion with real-time tracking.
          </p>
        </header>

        <div className={styles.grid}>
          {phases.map((phase) => (
            <article key={phase.title} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.iconTile}>{phase.icon}</span>
                <div>
                  <h3 className={styles.title}>{phase.title}</h3>
                  {phase.tag && <span className={styles.tag}>{phase.tag}</span>}
                </div>
              </div>

              <p className={styles.desc}>{phase.description}</p>

              <ol className={styles.steps}>
                {phase.steps.map((step, i) => (
                  <li key={step.title} className={styles.step}>
                    <span className={styles.node}>{i + 1}</span>
                    <div>
                      <h4 className={styles.stepTitle}>{step.title}</h4>
                      <p className={styles.stepText}>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
