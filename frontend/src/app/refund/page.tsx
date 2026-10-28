import type { Metadata } from "next";
import { LegalLayout, P, UL, type LegalSection } from "@/components/LegalLayout";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy | SSC Prep Hub",
  description: "When SSC Prep Hub refunds a payment, how to ask, and how long it takes.",
};

const sections: LegalSection[] = [
  {
    id: "nature",
    title: "Digital service, delivered instantly",
    body: (
      <P>
        Everything we sell — Premium plans, vocabulary unlocks, chapter PDFs, single mock tests and revision skips — is a digital service that becomes available
        to you as soon as the payment is confirmed. Because you can start using it immediately and it cannot be “returned”, <b>purchases are generally
        non-refundable once access has been activated.</b> Please read the plan details on the Premium page before you pay; you can try the free practice sets
        first.
      </P>
    ),
  },
  {
    id: "eligible",
    title: "When we do refund",
    body: (
      <>
        <UL>
          <li><b>Double or duplicate payment</b> for the same order — the extra amount is refunded in full.</li>
          <li><b>Payment taken but access not delivered</b> — if your plan or unlock did not activate and we cannot activate it within a reasonable time, we refund the full amount.</li>
          <li><b>Wrong amount charged</b> — we refund the difference.</li>
          <li><b>Serious service failure on our side</b> that stops you from using what you bought for an extended period and that we cannot fix.</li>
          <li><b>We end your account without any breach by you</b> — we refund the unused part of your paid plan.</li>
        </UL>
        <P>Each request is checked against our payment records, so please keep your order ID handy (see Payment history).</P>
      </>
    ),
  },
  {
    id: "not-eligible",
    title: "When we do not refund",
    body: (
      <UL>
        <li>You changed your mind, bought the wrong plan, or found the content did not match your expectations after using it.</li>
        <li>You did not use the plan, or your exam date, syllabus or plan changed.</li>
        <li>Vocabulary unlocks and skips, chapter PDFs and single mocks once delivered.</li>
        <li>Accounts suspended or closed for breaking the Terms, misusing offers or the referral programme, or sharing the account.</li>
        <li>Problems caused by your device, network or a third-party service we do not control.</li>
        <li>Discounts, coupons and referral rewards, which have no cash value.</li>
      </UL>
    ),
  },
  {
    id: "how",
    title: "How to ask for a refund",
    body: (
      <>
        <P>
          Email <a className="font-medium text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from your registered email address
          within <b>7 days</b> of the payment, with:
        </P>
        <UL>
          <li>your order ID (from Payment history) and the date and amount of the payment;</li>
          <li>a short description of the problem, and a screenshot if it helps.</li>
        </UL>
        <P>We reply within 2 working days with our decision.</P>
      </>
    ),
  },
  {
    id: "timeline",
    title: "How refunds are paid",
    body: (
      <UL>
        <li>Approved refunds go back to the <b>original payment method</b> through Cashfree. We cannot refund to a different card, UPI ID or account.</li>
        <li>Normally the money reaches your account within <b>5–7 working days</b> after we approve it; some banks take longer. We cannot speed up the bank’s part.</li>
        <li>When a payment is refunded, any Premium time or unlock that came with it is removed.</li>
      </UL>
    ),
  },
  {
    id: "cancel",
    title: "Cancelling",
    body: (
      <P>
        Plans do not renew automatically, so there is nothing to cancel and you will never be charged again unless you choose to buy. Your plan simply ends on the
        expiry date. A referral withdrawal that is still “Requested” can be cancelled from the Refer &amp; Earn page and the amount returns to your balance.
      </P>
    ),
  },
  {
    id: "referral",
    title: "Refunds and referral commission",
    body: (
      <P>
        If a payment that earned a referrer a commission is refunded, reversed or charged back, that commission is taken back from the referrer (see section 8 of
        the <a className="font-medium text-primary hover:underline" href="/terms#referral">Terms</a>). A friend’s welcome discount is not restored after a refund.
      </P>
    ),
  },
  {
    id: "chargeback",
    title: "Disputes and chargebacks",
    body: (
      <P>
        Please contact us before raising a dispute with your bank — it is much faster. If a chargeback is filed for a payment we delivered, we may suspend the
        related access and referral earnings while it is investigated, and recover any amount we are not allowed to keep.
      </P>
    ),
  },
];

export default function RefundPage() {
  return (
    <LegalLayout
      current="/refund"
      title="Refund & Cancellation Policy"
      intro={<p>A clear, fair policy: what we refund, what we cannot, and exactly how to ask.</p>}
      sections={sections}
    />
  );
}
