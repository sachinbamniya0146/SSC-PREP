import type { Metadata } from "next";
import { LegalLayout, P, UL, type LegalSection } from "@/components/LegalLayout";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Terms & Conditions | SSC Prep Hub",
  description: "The rules for using SSC Prep Hub: accounts, premium plans, payments, vocabulary, Refer & Earn and acceptable use.",
};

const sections: LegalSection[] = [
  {
    id: "acceptance",
    title: "Agreement and who may use SSC Prep Hub",
    body: (
      <>
        <P>
          These Terms &amp; Conditions (“Terms”) are a binding agreement between you and SSC Prep Hub (“we”, “us”), the operator of sscprephub.in and its
          related web and mobile pages (the “Service”). By creating an account, signing in with Google, buying a plan or otherwise using the Service you agree
          to these Terms, our <a className="font-medium text-primary hover:underline" href="/privacy">Privacy Policy</a> and our{" "}
          <a className="font-medium text-primary hover:underline" href="/refund">Refund &amp; Cancellation Policy</a>. If you do not agree, please do not use the Service.
        </P>
        <P>
          You must be able to form a legally binding contract under Indian law. If you are under 18, you may use the Service only with the knowledge and consent
          of a parent or legal guardian, who is responsible for your use and for any purchase made from your account.
        </P>
      </>
    ),
  },
  {
    id: "service",
    title: "What the Service is (and is not)",
    body: (
      <>
        <P>SSC Prep Hub is an exam-preparation platform for SSC and similar competitive exams. Depending on your plan it includes:</P>
        <UL>
          <li>full-length mock tests, sectional tests and year-wise papers built to the exam pattern;</li>
          <li>a previous-year-question (PYQ) bank with solutions, chapter-wise practice and weak-topic practice;</li>
          <li>a vocabulary course with word-by-word mastery quizzes and daily revision;</li>
          <li>a study plan, performance analytics, streaks, leaderboards and optional reminders (email, push or Telegram);</li>
          <li>a Refer &amp; Earn programme (section 8).</li>
        </UL>
        <P>
          SSC Prep Hub is an independent private service. We are <b>not</b> affiliated with, endorsed by or sponsored by the Staff Selection Commission or any
          government body. Questions are compiled, edited and sometimes re-worded for practice; although we review them carefully, a question, option, answer key
          or explanation may occasionally contain an error. Use the “report” option on a question and we will review it. We do not promise any exam result, rank
          or selection.
        </P>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <>
        <UL>
          <li>Give accurate details (name, a working email and mobile number). Temporary / disposable email addresses are not allowed.</li>
          <li>One person, one account. Do not share your login or let others use your premium access. We may limit the number of devices that can be signed in at once.</li>
          <li>Keep your password confidential. You are responsible for activity on your account until you tell us it has been compromised.</li>
          <li>Tell us promptly at {SUPPORT_EMAIL} if you suspect unauthorised use.</li>
        </UL>
      </>
    ),
  },
  {
    id: "plans",
    title: "Free access and Premium plans",
    body: (
      <>
        <P>
          Some content is free (for example a limited number of practice sets per subject or chapter). Premium plans unlock more, such as unlimited practice,
          premium mock tests, detailed solutions, chapter PDFs and analytics. What each plan includes and what it costs is always shown on the Premium page before
          you pay; that page is part of these Terms.
        </P>
        <UL>
          <li>A plan runs for the period shown (for example 1, 3, 6 or 12 months) from the moment payment is confirmed.</li>
          <li>Plans <b>stack</b>: if you buy a plan while one is running, the new period is added after your current expiry — you do not lose the time you already paid for.</li>
          <li>Plans do not renew automatically. We will remind you before your plan ends, and you can renew with one click.</li>
          <li>Premium is personal to your account and cannot be transferred, shared or resold.</li>
          <li>We may change prices, plans and features for future purchases. A change never reduces the period or features of a plan you have already bought.</li>
        </UL>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments",
    body: (
      <>
        <P>
          Payments are processed by our payment partner, Cashfree Payments, using cards, UPI, net banking or wallets. We never see or store your full card number,
          CVV, UPI PIN or net-banking credentials. The amount you are charged is calculated on our servers from the plan price, any running offer, and any coupon
          or referral discount, and is shown to you before you pay. Prices are in Indian Rupees.
        </P>
        <UL>
          <li>Access starts automatically once the payment gateway confirms the payment. Some methods (for example UPI collect) can take a few minutes; the app keeps checking and also receives confirmation directly from the gateway.</li>
          <li>If money was debited but your plan is not active after about 30 minutes, write to {SUPPORT_EMAIL} with your order ID — we will activate it or refund it.</li>
          <li>Invoices for successful payments are available in <a className="font-medium text-primary hover:underline" href="/premium/history">Payment history</a>.</li>
          <li>Taxes: the price you see at checkout is the final price you pay unless the checkout page says otherwise.</li>
        </UL>
      </>
    ),
  },
  {
    id: "offers",
    title: "Offers, coupons and welcome discounts",
    body: (
      <>
        <UL>
          <li>Offers and coupons are limited-time, may have a minimum amount, a maximum discount, a per-student limit and plan restrictions, and can be withdrawn at any time without affecting orders already paid.</li>
          <li>A coupon and the “friend’s invite” welcome discount are <b>not combined</b> — if both could apply, you automatically get whichever gives the lower price.</li>
          <li>The welcome discount is for a referred student’s <b>first plan purchase only</b>.</li>
          <li>Coupons have no cash value and cannot be sold or transferred. We may cancel discounts obtained through misuse, automation or fake accounts.</li>
        </UL>
      </>
    ),
  },
  {
    id: "vocabulary",
    title: "Vocabulary course: unlocking, revision and paid options",
    body: (
      <>
        <P>The vocabulary course opens word by word as you master them.</P>
        <UL>
          <li>Scoring the required mastery score (currently 95% or more) on a word unlocks the next word. <b>A word that has been unlocked stays unlocked</b> — it does not lock again.</li>
          <li>Daily revision and “re-master” checks may temporarily pause <i>new</i> words until you finish them. That is a pause shown clearly on the vocabulary page, not a lock on words you already unlocked.</li>
          <li>You may optionally pay to unlock a single word, to unlock all words, to subscribe to the vocabulary plan, or to skip a day’s revision. These options and their prices are shown before payment. They are digital services delivered immediately, so they are not refundable once delivered (see the Refund Policy).</li>
        </UL>
      </>
    ),
  },
  {
    id: "referral",
    title: "Refer & Earn programme",
    body: (
      <>
        <P>
          Registered students can invite friends with a personal code or link. The exact percentages, hold period and limits are always shown on your Refer &amp;
          Earn page and may be changed by us as described below.
        </P>
        <h3 className="mt-5 font-semibold">8.1 What you and your friend get</h3>
        <UL>
          <li><b>Your friend</b> gets a welcome discount (a percentage, with a maximum amount, as shown on the Refer &amp; Earn and Premium pages) on their first plan purchase, if they join using your code before buying.</li>
          <li><b>You</b> earn a cash commission — a percentage of the amount your friend actually pays — on every <b>plan</b> purchase they make. The percentage starts at a base rate and increases once a set number of your friends have bought a plan.</li>
          <li>Commission is earned only on plan purchases. It is not earned on one-off add-ons (single words, chapter PDFs, single mocks, revision skips), on free or 100%-discounted activations, or on anything refunded.</li>
          <li>Milestone rewards (such as a free month of Premium or a free upgrade after a set number of paying friends) are Premium time, not cash, and are granted once.</li>
        </UL>
        <h3 className="mt-5 font-semibold">8.2 When commission becomes yours</h3>
        <UL>
          <li>New commission is <b>Pending</b> for a hold period (shown on your page) to protect against refunds and chargebacks. After that it becomes <b>Withdrawable</b>.</li>
          <li>If the payment behind a commission is refunded, reversed or charged back, or is found to be fraudulent, the commission is taken back. If it has already been released, it is deducted from your balance, which can go below zero until new earnings cover it.</li>
          <li>Some commissions may be held for a manual check before release (for example when two accounts appear to be used from the same device).</li>
        </UL>
        <h3 className="mt-5 font-semibold">8.3 Withdrawals</h3>
        <UL>
          <li>Only released commission can be withdrawn, subject to a minimum amount and a minimum number of paying friends (both shown on your page).</li>
          <li>Money is sent to a UPI ID or bank account <b>in your own name</b> that you save in the app. You are responsible for entering correct details; we are not liable for transfers made to details you provided.</li>
          <li>Each request is reviewed by us before payment. You may have one request in progress at a time and may cancel a request that is still pending. A rejected or failed payout is returned to your balance.</li>
          <li>You are responsible for any tax due on your earnings, and we may deduct or report tax where the law requires it.</li>
        </UL>
        <h3 className="mt-5 font-semibold">8.4 Rules and misuse</h3>
        <UL>
          <li>No self-referral, no referring yourself through another account, no circular referrals (A refers B and B refers A), no fake or duplicate accounts, and no buying a plan only to collect commission.</li>
          <li>No spam: do not post your link in a misleading way, impersonate SSC Prep Hub or promise results.</li>
          <li>If we find or reasonably suspect misuse, we may withhold or reverse commission, cancel discounts, freeze the wallet and suspend or close the account. Decisions are made in good faith after review; you may reply to us with an explanation.</li>
        </UL>
        <h3 className="mt-5 font-semibold">8.5 Changes</h3>
        <P>
          We may change, pause or end the programme at any time. Changes apply to future purchases; commission already earned and not reversed stays withdrawable
          even if the programme is paused or ends.
        </P>
      </>
    ),
  },
  {
    id: "conduct",
    title: "Acceptable use",
    body: (
      <>
        <P>You agree not to:</P>
        <UL>
          <li>copy, scrape, download in bulk, republish, sell or share our questions, solutions, PDFs, vocabulary or other content, or use them to build a competing product or train AI models;</li>
          <li>share, sell or rent your account, or bypass plan limits, device limits, payment, unlock or revision rules;</li>
          <li>use bots, scripts, emulators or any trick to take tests, farm XP/streaks or manipulate leaderboards;</li>
          <li>attempt to break, probe or overload the Service, or access another person’s data;</li>
          <li>post unlawful, abusive, hateful or misleading content in support chat or anywhere else, or harass staff or other students;</li>
          <li>use the Service for anything unlawful.</li>
        </UL>
      </>
    ),
  },
  {
    id: "ip",
    title: "Content and intellectual property",
    body: (
      <>
        <P>
          The Service, including its software, design, tests, compilations, explanations, vocabulary content and branding, is owned by us or our licensors and is
          protected by law. Previous-year question papers remain the property of the respective exam authority; our selection, arrangement, solutions and
          explanations are ours. We grant you a personal, non-exclusive, non-transferable, revocable licence to use the Service for your own exam preparation.
        </P>
        <P>
          Notes, bookmarks and messages you create stay yours, but you give us permission to store and process them to run the Service. If you send feedback or
          report a question, we may use it to improve the Service without owing you anything.
        </P>
      </>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    body: (
      <>
        <P>
          You can stop using the Service and ask us to delete your account at any time (write to {SUPPORT_EMAIL}). We may suspend or terminate an account, with or
          without notice, if you break these Terms, misuse offers or the referral programme, commit payment fraud, or put the Service or other students at risk.
        </P>
        <UL>
          <li>A suspended account cannot sign in. We will tell you the reason and how to contact us; if we made a mistake we will lift the suspension.</li>
          <li>If we terminate your account for a serious breach, unused Premium time and pending referral earnings may be forfeited. If we end your account without a breach by you, we will refund the unused part of a paid plan.</li>
          <li>Permanent deletion removes your learning data, notes and referral records. We keep payment records as the law requires.</li>
        </UL>
      </>
    ),
  },
  {
    id: "disclaimer",
    title: "Disclaimers and limits of liability",
    body: (
      <>
        <P>
          The Service is provided “as is” and “as available”. We work hard to keep it accurate and online, but we do not guarantee uninterrupted or error-free
          operation, that all content is free of errors, or that using it will improve your marks or result in selection. Study materials are an aid, not a
          substitute for the official notification and syllabus — always check the official exam notice.
        </P>
        <P>
          To the fullest extent permitted by law, we are not liable for indirect or consequential loss, loss of opportunity, or loss caused by events outside our
          reasonable control (such as network or power failure, a payment-gateway outage or a device problem). Our total liability for any claim relating to the
          Service is limited to the amount you paid us in the 12 months before the claim. Nothing in these Terms limits liability that cannot be limited by law.
        </P>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    body: (
      <P>
        We may update these Terms from time to time. The “Last updated” date above shows the current version. For significant changes we will notify you in the
        app or by email. If you keep using the Service after a change takes effect, you accept the updated Terms; if you do not agree, stop using the Service and
        contact us about closing your account.
      </P>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <P>
        These Terms are governed by the laws of India. Please write to us first at {SUPPORT_EMAIL} — most problems can be settled quickly. If a dispute cannot
        be settled informally, it is subject to the exclusive jurisdiction of the competent courts in India.
      </P>
    ),
  },
  {
    id: "contact",
    title: "Contact and grievance officer",
    body: (
      <>
        <P>
          For support, billing, privacy or any complaint about content or conduct on the Service, write to <a className="font-medium text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          As required by the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, this address is also our Grievance
          Officer contact. We acknowledge complaints within 48 hours and aim to resolve them within 15 days.
        </P>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalLayout
      current="/terms"
      title="Terms & Conditions"
      intro={<p>Please read these terms carefully. They explain how SSC Prep Hub works, what you can expect from us and what we expect from you — including how Premium, payments, vocabulary and Refer &amp; Earn work.</p>}
      sections={sections}
    />
  );
}
