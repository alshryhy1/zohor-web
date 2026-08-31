import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT, LEGAL_PRIVACY, LegalPage, LegalSection } from "../_components/legal-page";

export const metadata: Metadata = {
  title: "الدعم وحذف الحساب — لحظة",
  description: "تواصل مع لحظة واطلب حذف حسابك وبياناتك.",
};

export default function SupportPage() {
  return (
    <LegalPage title="الدعم وحذف الحساب" titleEn="Support & Account Deletion">
      <LegalSection title="روابط App Store Connect">
        <p>ضع هذه الروابط في بيانات التطبيق على App Store Connect:</p>
        <ul>
          <li>
            Privacy Policy:{" "}
            <a href="https://www.lahzha.com/privacy" style={{ color: "#C9A24D" }}>
              https://www.lahzha.com/privacy
            </a>
          </li>
          <li>
            Terms of Use (EULA):{" "}
            <a href="https://www.lahzha.com/terms" style={{ color: "#C9A24D" }}>
              https://www.lahzha.com/terms
            </a>
          </li>
          <li>
            Support URL:{" "}
            <a href="https://www.lahzha.com/support" style={{ color: "#C9A24D" }}>
              https://www.lahzha.com/support
            </a>
          </li>
          <li>
            Marketing URL:{" "}
            <a href="https://www.lahzha.com/" style={{ color: "#C9A24D" }}>
              https://www.lahzha.com/
            </a>
          </li>
          <li>
            Community / UGC:{" "}
            <a href="https://www.lahzha.com/community" style={{ color: "#C9A24D" }}>
              https://www.lahzha.com/community
            </a>
          </li>
        </ul>
        <p>
          حذف الحساب متاح داخل التطبيق (حسابي → إعدادات → حذف الحساب نهائيًا) وعبر هذه الصفحة بالبريد — وفق متطلب أبل
          لحسابات المستخدمين.
        </p>
      </LegalSection>

      <LegalSection title="التواصل">
        <p>
          الدعم:{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} style={{ color: "#C9A24D" }}>
            {LEGAL_CONTACT}
          </a>
          <br />
          الخصوصية:{" "}
          <a href={`mailto:${LEGAL_PRIVACY}`} style={{ color: "#C9A24D" }}>
            {LEGAL_PRIVACY}
          </a>
        </p>
        <p>
          هذه الصفحة هي عنوان الدعم العام للموقع والتطبيق، وعنوان «خيارات الخصوصية» لحذف الحساب إن تعذّر فتح التطبيق.
        </p>
      </LegalSection>

      <LegalSection title="حذف الحساب من التطبيق">
        <ol>
          <li>افتح تبويب حسابي ثم الإعدادات.</li>
          <li>اختر «حذف الحساب نهائيًا» ثم أكّد.</li>
          <li>يُمسح الحساب واللحظات والمنشورات والمتابعات والمحادثات وغرفك من المصدر.</li>
        </ol>
      </LegalSection>

      <LegalSection title="حذف الحساب بالبريد">
        <p>
          إن فقدت الجهاز أو تعذّر الدخول، راسل {LEGAL_CONTACT} من بريد الحساب المسجّل بعنوان «حذف الحساب» واذكر اسم
          المستخدم. نكمّل الحذف خلال 30 يومًا.
        </p>
      </LegalSection>

      <LegalSection title="ما الذي يبقى بعد الحذف">
        <p>
          قد نحتفظ مؤقتًا بسجلات مالية أو بلاغات سلامة إذا فرض النظام ذلك. اللمعات غير المستخدمة لا تُسترد نقدًا.
          المحتوى الذي نشره غيرك ويذكرك قد يبقى بعد إزالة هويتك حيث يلزم السياق.
        </p>
      </LegalSection>

      <LegalSection title="الوثائق">
        <p>
          <Link href="/privacy" style={{ color: "#C9A24D" }}>
            سياسة الخصوصية
          </Link>
          {" · "}
          <Link href="/terms" style={{ color: "#C9A24D" }}>
            شروط الاستخدام
          </Link>
          {" · "}
          <Link href="/community" style={{ color: "#C9A24D" }}>
            معايير المجتمع
          </Link>
        </p>
      </LegalSection>

      <LegalSection title="English summary">
        <p>
          Support: {LEGAL_CONTACT}. Privacy: {LEGAL_PRIVACY}. Delete your account in the app under My Account →
          Settings → Delete account, or email us from your registered address. We complete deletion within 30 days
          except records we must keep by law. Unused virtual coins are not cashed out.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
