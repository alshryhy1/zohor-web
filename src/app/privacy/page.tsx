import type { Metadata } from "next";
import { LEGAL_CONTACT, LEGAL_PRIVACY, LegalPage, LegalSection } from "../_components/legal-page";

export const metadata: Metadata = {
  title: "سياسة الخصوصية — لحظة",
  description: "كيف يجمع تطبيق لحظة بياناتك ويستخدمها ويحذفها.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="سياسة الخصوصية" titleEn="Privacy Policy">
      <LegalSection title="من نحن">
        <p>
          «لحظة» تطبيق وموقع للتواصل الاجتماعي والبث المباشر على النطاق lahzha.com. هذه السياسة توضّح البيانات التي
          نجمعها ولماذا، وكيف يمكنك طلب حذفها. نلتزم بمتطلبات خصوصية App Store ومبادئ نظام حماية البيانات الشخصية في
          المملكة العربية السعودية حيثما انطبق.
        </p>
      </LegalSection>

      <LegalSection title="البيانات التي نجمعها">
        <p>نجمع فقط ما يلزم لتشغيل الحساب والمحتوى والبث والدفع:</p>
        <ul>
          <li>الحساب: البريد، كلمة المرور (مشفّرة لدى مزوّد المصادقة)، الاسم، اسم المستخدم، الصورة.</li>
          <li>المحتوى الذي تنشره: لحظات، منشورات الخريطة، تعليقات، رسائل، بث صوتي أو مرئي.</li>
          <li>الموقع: إذا نشرت على الخريطة أو منحت إذن الموقع.</li>
          <li>الكاميرا والميكروفون: أثناء الرفع أو البث، وبإذنك فقط وعلى جهازك.</li>
          <li>المشتريات: حزم اللمعات عبر متجر أبل أو مزوّد دفع محلي، دون تخزين رقم بطاقتك لدينا.</li>
          <li>أرباح المذيع وطلبات السحب إن استخدمتها، بما في ذلك بيانات الهوية ووسيلة الدفع عند الطلب.</li>
          <li>بيانات تقنية: عنوان تقريبي، نوع الجهاز، سجلات أعطال لازمة للأمان.</li>
        </ul>
      </LegalSection>

      <LegalSection title="كيف نستخدمها">
        <p>
          لتشغيل الحساب، عرض المحتوى، البث والصوت، منع الإساءة (كتم، طرد، حظر، إشراف)، تنفيذ الشراء والتسليم، مراجعة
          أهلية السحب، والتواصل بخصوص الحساب. لا نبيع بياناتك الشخصية.
        </p>
      </LegalSection>

      <LegalSection title="المشاركة مع أطراف ثالثة">
        <p>نشارك الحد الأدنى اللازم مع مزوّدين يعملون لصالح الخدمة:</p>
        <ul>
          <li>Apple — تسجيل الدخول عند استخدامه، والمشتريات داخل التطبيق.</li>
          <li>Supabase — المصادقة وتخزين البيانات والملفات.</li>
          <li>Agora — نقل الصوت والصورة أثناء البث والغرف الصوتية.</li>
          <li>مزوّد دفع محلي عند الشحن من الويب داخل المملكة.</li>
        </ul>
        <p>هؤلاء المزوّدون يعالجون البيانات وفق عقودهم وسياساتهم، وليس لأغراض تسويقنا الخاصة.</p>
      </LegalSection>

      <LegalSection title="الاحتفاظ والحذف">
        <p>
          نحتفظ ببيانات الحساب ما دام الحساب قائمًا. عند حذف الحساب من التطبيق أو عبر طلب إلى {LEGAL_CONTACT} نمسح
          الحساب والمحتوى الذي أنشأته والمتابعات والمحادثات وغرفك خلال 30 يومًا، إلا ما يفرض النظام الاحتفاظ به (مثل
          سجلات مالية أو بلاغات سلامة) وللمدة التي يطلبها القانون فقط.
        </p>
        <p>
          اللمعات غير المستخدمة تُلغى مع الحساب ولا تُحوَّل إلى نقد. طلبات السحب المكتملة أو قيد المراجعة تُعالَج وفق
          السجلات المالية المعمول بها.
        </p>
      </LegalSection>

      <LegalSection title="حقوقك">
        <p>
          يمكنك الوصول إلى بيانات ملفك من التطبيق، وتصحيح الاسم والصورة، وحذف الحساب من الإعدادات داخل التطبيق. لطلب
          نسخة أو استفسار خصوصية راسل {LEGAL_PRIVACY}.
        </p>
      </LegalSection>

      <LegalSection title="الأطفال">
        <p>
          الخدمة غير موجّهة لمن دون 13 عامًا. الشراء والهدايا والسحب لمن أتمّ 18 عامًا. إذا علمنا بحساب لطفل دون السن
          المسموح نحذفه.
        </p>
      </LegalSection>

      <LegalSection title="الأذونات على الجهاز">
        <p>
          الكاميرا والميكروفون والموقع والصور تُطلب لغرض واضح في النظام، ويمكنك رفضها أو سحبها من إعدادات الجهاز. رفض
          الإذن قد يمنع ميزة معيّنة دون منع بقية التطبيق.
        </p>
      </LegalSection>

      <LegalSection title="ملفات الارتباط">
        <p>نستخدم جلسة تسجيل الدخول وضوابط تقنية لازمة للتشغيل. لا نستخدم إعلانات طرف ثالث لتتبعك عبر المواقع.</p>
      </LegalSection>

      <LegalSection title="التواصل">
        <p>
          الخصوصية: {LEGAL_PRIVACY}
          <br />
          الدعم: {LEGAL_CONTACT}
        </p>
      </LegalSection>

      <LegalSection title="English summary">
        <p>
          Lahza (“لحظة”) on lahzha.com collects account, profile, user content, optional location, camera/microphone
          while you broadcast or upload, purchase records via Apple or a local payment provider, and limited device
          logs. We use this to run the service, moderate abuse, deliver virtual coins, and process eligible host
          payouts. We do not sell personal data. Processors include Apple, Supabase, Agora, and a payments provider.
          Delete your account in the app settings or email {LEGAL_CONTACT}; we complete deletion within 30 days except
          records we must keep by law. Purchases, gifts, and withdrawals are 18+. Contact {LEGAL_PRIVACY} for privacy
          requests.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
