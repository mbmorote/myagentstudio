/**
 * app/privacy/page.tsx
 *
 * Plan 12 — Privacy Policy page (2026-08-15). Public route added to
 * middleware.ts's PUBLIC_PATHS. Linked from /welcome's footer.
 * Company name: ProcessMind Solutions (consistent with WorkbenchShell.tsx footer).
 *
 * Server component — no interactivity; rendered once on the server, no 'use client'.
 * Uses h-screen + overflow-y-auto (not min-h-screen) for the same reason WelcomePage does:
 * app/globals.css sets body{overflow:hidden} for the Workbench shell's fixed-viewport
 * layout, which would block scroll on a normal page. The root div is its own scroll container.
 */

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_AUTHOR_EMAIL || null;

export default function PrivacyPage() {
  return (
    <div className="flex flex-col h-screen overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-[5] border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-4 max-w-[780px] mx-auto px-7 py-3">
          <div className="flex items-center gap-[9px] font-bold tracking-[-0.01em] text-[15px]">
            <span
              className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
              style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
            />
            MyAgent
          </div>
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
        <h1 className="text-[28px] tracking-[-0.02em] mb-2">Privacy Policy</h1>
        <p className="text-[12px] text-[var(--faint)] mb-10">Last updated: August 15, 2026</p>

        <div className="text-[14px] leading-[1.65]">

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">1. Information We Collect</h2>
            <p className="text-[var(--muted)] mb-3">
              When you use the Service, ProcessMind Solutions collects the following categories of
              information:
            </p>
            <ul className="list-disc list-inside text-[var(--muted)] space-y-1 ml-1">
              <li><strong>Account information:</strong> your name and email address, provided at signup.</li>
              <li><strong>Agent configuration data:</strong> the agent files you import, create, or edit within the Service.</li>
              <li><strong>Chat content:</strong> messages you send through the built-in chat interface, including any instructions or context submitted to the AI provider.</li>
              <li><strong>Usage metadata:</strong> information about your AI interactions (which agent, timestamp, token counts) logged for administrative and audit purposes.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">2. How We Use Your Information</h2>
            <p className="text-[var(--muted)] mb-3">We use the information we collect to:</p>
            <ul className="list-disc list-inside text-[var(--muted)] space-y-1 ml-1">
              <li>Provide, operate, and maintain the Service.</li>
              <li>Respond to your requests and communicate with you about your account.</li>
              <li>Audit usage and maintain the security and integrity of the Service.</li>
            </ul>
            <p className="text-[var(--muted)] mt-3">We do not sell your personal data.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">3. Third-Party Processors</h2>
            <p className="text-[var(--muted)]">
              The Service uses an external AI provider (Anthropic and/or an OpenAI-compatible vendor,
              depending on the deployment&apos;s configuration) to process chat messages and agent import
              requests. Content you submit through the chat and import interfaces is transmitted to and
              processed by that provider. Their data practices are governed by their own privacy policies,
              not this one.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">4. Data Storage &amp; Security</h2>
            <p className="text-[var(--muted)]">
              Your data is stored on servers operated by or on behalf of ProcessMind Solutions. We take
              reasonable technical and organizational measures to protect your data against unauthorized
              access, loss, or disclosure. However, no method of transmission over the internet or
              electronic storage is completely secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">5. Cookies &amp; Session Tokens</h2>
            <p className="text-[var(--muted)]">
              The Service uses a session cookie to maintain your login state. This cookie is required
              for the Service to function and is cleared when you log out or when your session expires.
              We do not use tracking cookies, analytics cookies, or third-party advertising cookies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">6. Data Retention</h2>
            <p className="text-[var(--muted)]">
              We retain your account information and agent data for as long as your account is active
              or as needed to provide the Service. Activity log entries (usage metadata) may be retained
              for a reasonable period for administrative and audit purposes.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">7. Your Rights</h2>
            <p className="text-[var(--muted)]">
              Depending on your jurisdiction, you may have the right to access, correct, or request
              deletion of the personal data we hold about you. To exercise these rights, contact us
              using the information below. Please note that deleting your account data may result in
              permanent loss of your agent configurations.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">8. Changes to This Policy</h2>
            <p className="text-[var(--muted)]">
              We may update this Privacy Policy from time to time. We will indicate material changes by
              updating the &quot;Last updated&quot; date at the top of this page. Your continued use of the
              Service after any changes constitutes your acceptance of the updated Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">9. Contact</h2>
            <p className="text-[var(--muted)]">
              If you have questions about this Privacy Policy or wish to exercise your data rights,
              contact ProcessMind Solutions
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
      <div className="border-t border-[var(--border)] bg-[var(--panel)] text-[11.5px] text-[var(--faint)]">
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
