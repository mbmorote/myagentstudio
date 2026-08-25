/**
 * app/terms/page.tsx
 *
 * Plan 12 — Terms of Service page (2026-08-15). Public route added to
 * middleware.ts's PUBLIC_PATHS. Linked from /welcome's footer.
 * Company name: ProcessMind Solutions (consistent with WorkbenchShell.tsx footer).
 *
 * Rewritten 2026-08-18 alongside app/privacy/page.tsx: added a "Who We Are"
 * section naming the real legal entity (a Brazilian Empresário Individual
 * under Simples Nacional) at the operator's explicit request — deliberately
 * excludes CPF, home address, and phone number even though those exist in the
 * underlying registration record, since this public page has no legitimate
 * need for that level of personal detail. Also closes the roadmap's
 * "[jurisdiction] placeholder" TODO item — governing law is Brazil, matching
 * where the entity is actually registered.
 *
 * Legal-entity name/CNPJ moved to env vars 2026-08-24 (same reasoning as
 * CONTACT_EMAIL below): the actual value only needs to exist in production's
 * untracked .env.local, never in source. Unset falls back to a generic
 * statement that's still accurate, not a broken/empty page.
 *
 * Server component — no interactivity; rendered once on the server, no 'use client'.
 * Uses h-screen + overflow-y-auto (not min-h-screen) for the same reason WelcomePage does:
 * app/globals.css sets body{overflow:hidden} for the Workbench shell's fixed-viewport
 * layout, which would block scroll on a normal page. The root div is its own scroll container.
 */

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_AUTHOR_EMAIL || null;
const LEGAL_ENTITY_NAME = process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || null;
const LEGAL_ENTITY_CNPJ = process.env.NEXT_PUBLIC_LEGAL_ENTITY_CNPJ || null;

export default function TermsPage() {
  return (
    <div className="flex flex-col h-screen overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-[5] border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-4 max-w-[780px] mx-auto px-7 py-3">
          <a
            href="/welcome"
            className="flex items-center gap-[9px] font-bold tracking-[-0.01em] text-[15px] text-[var(--text)] no-underline hover:opacity-80"
          >
            <span
              className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
              style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
            />
            MyAgentStudio
          </a>
          <div className="flex-1" />
          <a
            href="/welcome"
            className="text-[13px] text-[var(--muted)] no-underline hover:text-[var(--text)]"
          >
            ← Back
          </a>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="max-w-[780px] mx-auto px-7 py-10 w-full flex-1">
        <h1 className="text-[28px] tracking-[-0.02em] mb-2">Terms of Service</h1>
        <p className="text-[12px] text-[var(--faint)] mb-6">Last updated: August 18, 2026</p>
        <p className="text-[14px] text-[var(--muted)] leading-[1.65] mb-10">
          These Terms of Service govern your access to and use of MyAgentStudio (the &quot;Service&quot;),
          operated by ProcessMind Solutions (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
        </p>

        <div className="text-[14px] leading-[1.65]">

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">1. Who We Are</h2>
            <p className="text-[var(--muted)]">
              {LEGAL_ENTITY_NAME && LEGAL_ENTITY_CNPJ ? (
                <>
                  This Service is operated by {LEGAL_ENTITY_NAME}, doing business as ProcessMind
                  Solutions (CNPJ {LEGAL_ENTITY_CNPJ}), a Brazilian individual entrepreneurship
                  (Empresário Individual) registered under Simples Nacional.
                </>
              ) : (
                <>
                  This Service is operated by ProcessMind Solutions, a Brazilian individual
                  entrepreneurship (Empresário Individual) registered under Simples Nacional.
                  Full legal-entity registration details are available on request.
                </>
              )}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">2. Acceptance of Terms</h2>
            <p className="text-[var(--muted)]">
              By accessing or using MyAgentStudio (the &quot;Service&quot;), you agree to be bound by these Terms of
              Service and all applicable laws and regulations. If you do not agree with any of these
              terms, do not access or use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">3. Description of Service</h2>
            <p className="text-[var(--muted)]">
              MyAgentStudio is a web-based workbench for creating, editing, and managing AI agent
              configuration files. It is provided as a portfolio and demonstration project by
              ProcessMind Solutions. The Service integrates with external AI providers to offer
              chat-guided editing and structured import capabilities.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">4. User Accounts &amp; Responsibilities</h2>
            <p className="text-[var(--muted)]">
              Access to the Service requires an invite code or an approved access request. You are
              responsible for maintaining the confidentiality of your account credentials and for all
              activity that occurs under your account. You agree to notify us promptly of any
              unauthorized use of your account.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">5. Acceptable Use</h2>
            <p className="text-[var(--muted)] mb-3">You agree not to use the Service to:</p>
            <ul className="list-disc list-inside text-[var(--muted)] space-y-1 ml-1">
              <li>Upload, submit, or transmit passwords, API keys, credentials, personal health information, financial account numbers, or any other sensitive or confidential data.</li>
              <li>Violate any applicable law or regulation.</li>
              <li>Interfere with or disrupt the integrity or performance of the Service or its related systems.</li>
              <li>Attempt to gain unauthorized access to any part of the Service.</li>
              <li>Use the Service for any commercial purpose without prior written consent from ProcessMind Solutions.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">6. Intellectual Property</h2>
            <p className="text-[var(--muted)]">
              The Service and its original content, features, and functionality are and will remain the
              exclusive property of ProcessMind Solutions. Agent configuration files you create or import
              remain your property. You grant ProcessMind Solutions a limited license to store and process
              your content solely as necessary to provide the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">7. Disclaimers &amp; Limitation of Liability</h2>
            <p className="text-[var(--muted)] mb-3">
              The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind,
              express or implied. ProcessMind Solutions makes no warranty that the Service will be
              uninterrupted, error-free, or free of harmful components. This is a portfolio and
              demonstration project — use it accordingly.
            </p>
            <p className="text-[var(--muted)]">
              To the maximum extent permitted by applicable law, ProcessMind Solutions shall not be liable
              for any indirect, incidental, special, consequential, or punitive damages arising from your
              access to or use of (or inability to use) the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">8. Termination</h2>
            <p className="text-[var(--muted)]">
              We reserve the right to suspend or terminate your access to the Service at any time, with
              or without cause, with or without notice. Upon termination, your right to use the Service
              ceases immediately.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">9. Changes to These Terms</h2>
            <p className="text-[var(--muted)]">
              We may update these Terms from time to time. We will indicate material changes by updating
              the &quot;Last updated&quot; date at the top of this page. Your continued use of the Service after
              any changes constitutes your acceptance of the revised Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">10. Governing Law</h2>
            <p className="text-[var(--muted)]">
              These Terms are governed by and construed in accordance with the laws of Brazil, without
              regard to its conflict of law provisions. Any disputes arising under or in connection with
              these Terms shall be subject to the exclusive jurisdiction of the courts of Brazil.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">11. Contact</h2>
            <p className="text-[var(--muted)]">
              If you have questions about these Terms of Service, contact ProcessMind Solutions
              {CONTACT_EMAIL ? (
                <> at <a href={CONTACT_EMAIL} className="text-[var(--accent-ink)]">{CONTACT_EMAIL.replace(/^mailto:/, '')}</a>.</>
              ) : (
                ' through the contact information provided on the Service.'
              )}
            </p>
          </section>

        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-[5] border-t border-[var(--border)] bg-[var(--panel)] text-[11.5px] text-[var(--faint)]">
        <div className="flex items-center gap-[18px] max-w-[780px] mx-auto px-7 py-[10px]">
          <div className="flex-1">
            &copy; {new Date().getFullYear()} ProcessMind Solutions. All rights reserved.
          </div>
          <div className="flex gap-4">
            <a href="/terms" className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Terms</a>
            <a href="/privacy" className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Privacy</a>
          </div>
        </div>
      </div>
    </div>
  );
}
