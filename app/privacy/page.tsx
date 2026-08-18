/**
 * app/privacy/page.tsx
 *
 * Plan 12 — Privacy Policy page (2026-08-15). Public route added to
 * middleware.ts's PUBLIC_PATHS. Linked from /welcome's footer.
 * Company name: ProcessMind Solutions (consistent with WorkbenchShell.tsx footer).
 *
 * Rewritten 2026-08-18 — the original ship was generic SaaS boilerplate; this
 * version is grounded in what the system actually does (verified against
 * lib/db/schema.ts and docs/system-about.md, not assumed), for an invite-only
 * beta of ~10-15 people drawn from IT/professional circles, not personal
 * friends — the audience is realistically likely to know about and ask for
 * GDPR/CCPA-style rights, so §10 ("Your Rights") names both frameworks
 * honestly rather than staying vague: CCPA's revenue/volume thresholds aren't
 * met at this scale, but GDPR applies per data-subject location regardless of
 * company size, so it's named specifically rather than assumed away. Requests
 * are handled manually (no self-service export/delete tool exists yet) —
 * stated as such, not overclaimed as automated compliance machinery this
 * project doesn't have. §1 ("Who We Are") names the real legal entity behind
 * ProcessMind Solutions (a Brazilian Empresário Individual, Simples Nacional)
 * at the operator's explicit request — deliberately excludes CPF, home
 * address, and phone number even though those exist in the underlying
 * registration record, since a public legal page has no legitimate need for
 * that level of personal detail and publishing it would be a real
 * identity-theft/safety risk with no offsetting benefit.
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
          <a
            href="/welcome"
            className="flex items-center gap-[9px] font-bold tracking-[-0.01em] text-[15px] text-[var(--text)] no-underline hover:opacity-80"
          >
            <span
              className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
              style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
            />
            MyAgent
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
        <h1 className="text-[28px] tracking-[-0.02em] mb-2">Privacy Policy</h1>
        <p className="text-[12px] text-[var(--faint)] mb-6">Last updated: August 18, 2026</p>
        <p className="text-[14px] text-[var(--muted)] leading-[1.65] mb-10">
          This Privacy Policy explains how ProcessMind Solutions (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;),
          operating this Service, collects, uses, and protects your personal information. By using the
          Service, you agree to the collection and use of information as described in this policy.
        </p>

        <div className="text-[14px] leading-[1.65]">

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">1. Who We Are</h2>
            <p className="text-[var(--muted)]">
              This Service is operated by [REDACTED], doing business as ProcessMind
              Solutions (CNPJ [REDACTED]), a Brazilian individual entrepreneurship (Empresário
              Individual) registered under Simples Nacional.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">2. Information We Collect</h2>
            <ul className="list-disc list-inside text-[var(--muted)] space-y-1 ml-1">
              <li><strong>Account information:</strong> your email address, for every account.</li>
              <li><strong>Request-access information:</strong> if you sign up via &quot;Request access&quot; (no invite code yet), we also collect your name and how you heard about us — this is deleted once an invite code is issued for you, not kept as ongoing account data.</li>
              <li><strong>Agent configuration data:</strong> the agent files you import, create, or edit within the Service.</li>
              <li><strong>Chat and import content:</strong> the instructions and content you submit through the chat interface or import dialog.</li>
              <li><strong>Usage metadata:</strong> which agent, which AI provider and model, timestamps, token counts, and call duration — logged for every AI call attempt, whether it succeeds, fails, or is blocked.</li>
              <li><strong>Google account information</strong> (only if you sign in with Google): your Google email address and account identifier. We do not receive or store your name from Google.</li>
              <li><strong>Session cookie:</strong> a signed token that keeps you logged in.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">3. How We Use Your Information</h2>
            <p className="text-[var(--muted)] mb-3">We use the information we collect to:</p>
            <ul className="list-disc list-inside text-[var(--muted)] space-y-1 ml-1">
              <li>Provide, operate, and maintain the Service.</li>
              <li>Maintain an audit trail of AI usage, for security and to keep track of shared API cost.</li>
              <li>Respond to your requests and communicate with you about your account.</li>
              <li>Process access requests and issue invite codes.</li>
            </ul>
            <p className="text-[var(--muted)] mt-3">We do not sell your personal data.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">4. Third-Party AI Providers</h2>
            <p className="text-[var(--muted)]">
              Content you submit through the chat and import interfaces is sent to whichever AI provider
              this deployment is currently configured to use — Anthropic, and/or an OpenAI-compatible
              vendor (e.g. NVIDIA), depending on an admin setting. Their own privacy policies govern how
              they handle that content once it reaches them, not this one.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">5. Who Can See Your Content — Including the Admin</h2>
            <p className="text-[var(--muted)]">
              The admin of this deployment can always see <strong>metadata</strong> about your AI calls —
              which agent, when, how many tokens — to audit the shared API key. They can see the{' '}
              <strong>actual text</strong> of your instructions and the AI&apos;s replies only if you&apos;ve
              turned on &quot;Share my prompts with the admin&quot; in your Account settings — off by
              default. This choice is not retroactive in either direction: turning it on does not expose
              past private calls; turning it off does not hide past shared ones.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">6. Data Sharing</h2>
            <p className="text-[var(--muted)]">
              We do not sell your data. It is shared only with the AI provider processing your request
              (§4) and, according to your own consent choice, with the admin (§5). We do not share your
              data with any other third party.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">7. Cookies &amp; Session Tokens</h2>
            <p className="text-[var(--muted)]">
              The Service uses a single session cookie to maintain your login state. This cookie is
              required for the Service to function and is cleared when you log out or when your session
              expires. We do not use tracking cookies, analytics cookies, or third-party advertising
              cookies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">8. Data Security</h2>
            <p className="text-[var(--muted)]">
              Passwords are hashed and never stored in plain text. Session tokens are cryptographically
              signed. We take reasonable technical measures to protect your data against unauthorized
              access, loss, or disclosure. However, no method of transmission over the internet or
              electronic storage is completely secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">9. Data Retention</h2>
            <p className="text-[var(--muted)]">
              We retain your account information and agent data for as long as your account is active.
              Usage metadata (the activity log) is currently retained indefinitely — a retention or purge
              policy is planned but not yet built.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">10. Your Rights</h2>
            <p className="text-[var(--muted)]">
              Depending on your location, you may have rights under frameworks like the GDPR (EU/UK) or
              CCPA (California) to access, correct, or request deletion of the personal data we hold about
              you. Contact us to exercise these rights — at this scale, requests are handled manually
              rather than through a self-service tool. Please note that deleting your account may result
              in permanent loss of your agent configurations.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">11. Children&apos;s Privacy</h2>
            <p className="text-[var(--muted)]">
              The Service is not directed at children under 13, and we do not knowingly collect personal
              data from children.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">12. Changes to This Policy</h2>
            <p className="text-[var(--muted)]">
              We may update this Privacy Policy from time to time. We will indicate material changes by
              updating the &quot;Last updated&quot; date at the top of this page. Your continued use of the
              Service after any changes constitutes your acceptance of the updated Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-[17px] font-semibold mb-2 tracking-[-0.01em]">13. Contact</h2>
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
