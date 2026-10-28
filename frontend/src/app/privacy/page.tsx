import type { Metadata } from "next";
import { LegalLayout, P, UL, type LegalSection } from "@/components/LegalLayout";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Privacy Policy | SSC Prep Hub",
  description: "What personal data SSC Prep Hub collects, why, who it is shared with, how long we keep it and the choices you have.",
};

const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who we are and what this covers",
    body: (
      <P>
        SSC Prep Hub (“we”, “us”) runs sscprephub.in. This policy explains what personal data we collect when you use the website and app, why we need it, who
        we share it with and what choices you have. We handle your data in line with the Information Technology Act, 2000 and the Digital Personal Data Protection
        Act, 2023 (DPDP Act). For the purposes of these laws we decide why and how your data is used.
      </P>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <P><b>Details you give us</b></P>
        <UL>
          <li>Account: full name, email address, mobile number, password (we store only a one-way hash, never the password itself), language and theme preferences.</li>
          <li>Sign in with Google: your name, email address and profile picture, as shared by Google.</li>
          <li>Referral: the referral code you used or share, and — only if you withdraw earnings — your UPI ID or bank account holder name, account number and IFSC.</li>
          <li>Messages you send to support chat or to us by email, and questions you report.</li>
          <li>Optional: your own AI-provider key if you choose to use AI explanations (stored encrypted and used only for your requests), and your Telegram link if you connect Telegram reminders.</li>
        </UL>
        <P><b>Created as you study</b></P>
        <UL>
          <li>Tests and practice: your attempts, answers, scores, time spent, bookmarks, notes, weak topics, vocabulary progress and revision, study-plan choices, streaks, XP and leaderboard position.</li>
          <li>Purchases: plan and order details, amount, status and time. Card, UPI and bank credentials are handled by Cashfree and never reach our servers.</li>
        </UL>
        <P><b>Collected automatically</b></P>
        <UL>
          <li>Device and session data: device identifier, browser/app type, IP address, approximate location derived from the IP address, and last-active time. We use it to keep your account secure, enforce device limits and spot fraud.</li>
          <li>Push-notification tokens, if you allow notifications.</li>
          <li>Technical logs (errors, request times) to keep the Service running.</li>
        </UL>
        <P>We do not run third-party advertising or behavioural-tracking scripts on the Service.</P>
      </>
    ),
  },
  {
    id: "use",
    title: "Why we use your data",
    body: (
      <UL>
        <li><b>To provide the Service:</b> create your account, run tests and practice, calculate results and analytics, unlock vocabulary, show leaderboards, and give you Premium access.</li>
        <li><b>To process payments and referrals:</b> create orders, confirm payments, issue invoices, calculate and pay referral commission, prevent duplicate or fraudulent claims.</li>
        <li><b>To keep things safe:</b> verify logins, protect accounts, detect abuse, enforce our Terms and meet legal obligations.</li>
        <li><b>To communicate:</b> verification and password emails, payment receipts, plan-expiry and study reminders, and important notices. Optional reminders can be switched off in your settings.</li>
        <li><b>To improve the product:</b> understand which features are used and fix problems, using aggregated or de-identified data wherever possible.</li>
      </UL>
    ),
  },
  {
    id: "legal-basis",
    title: "Consent and other grounds",
    body: (
      <P>
        We process your data because you consented when you signed up and agreed to the Terms, because it is needed to deliver what you asked for (for example a
        purchase), or because the law allows or requires it (for example keeping tax records). You can withdraw consent for optional things such as push or
        Telegram reminders at any time; withdrawing consent for data we need to run your account means we can no longer provide the Service to you.
      </P>
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <P>We do not sell your personal data. We share it only as needed with:</P>
        <UL>
          <li><b>Cashfree Payments</b> — to take payments (and Cashfree Payouts to send referral withdrawals). They receive your name, email, mobile number and order details.</li>
          <li><b>Google</b> — if you choose Sign in with Google.</li>
          <li><b>Email, push and messaging providers</b> (including Telegram if you connect it) — to deliver messages you asked for.</li>
          <li><b>Hosting and infrastructure providers</b> — who store and process data for us under confidentiality obligations.</li>
          <li><b>Authorities</b> — when required by law, court order or to protect rights, safety and against fraud.</li>
        </UL>
        <P>
          On leaderboards other students see your display name and score, not your email or phone. In Refer &amp; Earn, a friend sees only your first name before
          they sign up; you see your friends’ names shortened (for example “Rahul S.”) and never their email or phone.
        </P>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep data",
    body: (
      <>
        <UL>
          <li>Account and learning data: for as long as your account is active.</li>
          <li>When you ask us to delete your account (or we delete it), your profile, test history, notes, bookmarks, vocabulary and referral records are erased. Payment and invoice records are kept — detached from your profile — for as long as tax and accounting law requires.</li>
          <li>Security and audit logs: kept for a limited period needed to investigate misuse.</li>
        </UL>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your choices and rights",
    body: (
      <>
        <P>You can ask us to:</P>
        <UL>
          <li>show you the personal data we hold about you;</li>
          <li>correct inaccurate data (you can also edit most of it yourself in Profile);</li>
          <li>delete your account and data, subject to what we must keep by law;</li>
          <li>stop optional communications or withdraw a consent you gave;</li>
          <li>nominate someone to exercise these rights for you, as the DPDP Act allows.</li>
        </UL>
        <P>
          Email {SUPPORT_EMAIL} from your registered address. We may need to confirm who you are first. If you are unhappy with our answer you can complain to
          the Data Protection Board of India once it is operational.
        </P>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <P>
        Traffic between your device and our servers is encrypted (HTTPS). Passwords are hashed, sessions can be revoked, sensitive keys are encrypted, and
        access to administrative tools is restricted by role. No system is perfectly secure, so please use a strong, unique password and sign out on shared
        devices. If a breach affects your personal data, we will notify you and the authorities as the law requires.
      </P>
    ),
  },
  {
    id: "storage",
    title: "Cookies and browser storage",
    body: (
      <P>
        We use your browser’s local storage (similar to cookies) to keep you signed in, remember your language and theme, remember a referral code from a link
        you opened (for up to 30 days) and keep drafts during tests. These are needed for the Service to work; clearing your browser data removes them.
      </P>
    ),
  },
  {
    id: "children",
    title: "Students under 18",
    body: (
      <P>
        Many exam aspirants are under 18. If you are under 18, please use the Service only with the consent of a parent or guardian. A parent or guardian may
        contact us at {SUPPORT_EMAIL} to review or delete a minor’s data. We do not show behavioural advertising to anyone.
      </P>
    ),
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <P>
        We may update this policy; the date at the top shows the latest version and we will tell you in the app or by email about important changes. Questions,
        requests and complaints: <a className="font-medium text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> — this is also our
        grievance contact. We acknowledge within 48 hours and aim to resolve within 15 days.
      </P>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalLayout
      current="/privacy"
      title="Privacy Policy"
      intro={<p>Your data is yours. This page says plainly what we collect to run your preparation, what we do with it and how you stay in control.</p>}
      sections={sections}
    />
  );
}
