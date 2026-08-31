import type { Metadata } from "next";
import { LEGAL_CONTACT, LegalPage, LegalSection } from "../_components/legal-page";

export const metadata: Metadata = {
  title: "معايير المجتمع — لحظة",
  description: "قواعد المحتوى والإبلاغ والحظر في لحظة، بما يتوافق مع سياسة المحتوى الذي ينشئه المستخدمون في أبل.",
};

export default function CommunityPage() {
  return (
    <LegalPage title="معايير المجتمع" titleEn="Community Standards">
      <LegalSection title="لماذا هذه الصفحة">
        <p>
          «لحظة» منصة محتوى ينشئه المستخدمون: لحظات، خريطة، دردشة، تعليقات، بث وغرف صوتية. وفق سياسة أبل للتطبيقات ذات
          المحتوى الذي ينشئه المستخدمون نوفر قواعد واضحة، وسيلة إبلاغ، حظرًا، وإشرافًا، ووسيلة تواصل منشورة.
        </p>
      </LegalSection>

      <LegalSection title="غير مسموح">
        <ul>
          <li>أي استغلال أو محتوى جنسي يشمل قاصرين — يُحذف ويُبلَّغ للجهات المختصة عند الاقتضاء.</li>
          <li>التحرش، التهديد، خطاب الكراهية، أو التنمّر.</li>
          <li>العنف الجرافيكي أو الترويج لنشاط إجرامي.</li>
          <li>الاحتيال، انتحال الشخصية، التلاعب بالهدايا أو الحسابات المرتبطة.</li>
          <li>الخصوصية المنتهكة: تصوير أو بث دون وجه حق، أو نشر بيانات غيرك.</li>
          <li>الرسائل العشوائية والروابط الخادعة.</li>
        </ul>
      </LegalSection>

      <LegalSection title="الإبلاغ">
        <p>
          أبلغ عن محتوى أو حساب مخالف عبر البريد:{" "}
          <a href={`mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent("إبلاغ عن محتوى أو حساب")}`} style={{ color: "#C9A24D" }}>
            {LEGAL_CONTACT}
          </a>{" "}
          مع رابط أو اسم المستخدم ووصف مختصر. من داخل التطبيق يمكنك أيضًا فتح «الدعم وحذف الحساب» في الإعدادات. نراجع
          البلاغات الجادّة في أقرب وقت ممكن، وعلى الأرجح خلال 24 ساعة للمحتوى الخطير.
        </p>
      </LegalSection>

      <LegalSection title="الحظر والكتم والطرد">
        <p>
          صاحب البث أو الغرفة — ومشرفوه — يمكنهم كتم التعليق والمايك، وطردك مؤقتًا دون حظر دائم، أو حظرك من غرفته.
          لطلب حظر مستخدم على مستوى الحساب راسل {LEGAL_CONTACT} من بريدك المسجّل بعنوان «طلب حظر» واذكر اسم المستخدم
          وسببًا مختصرًا؛ ننفّذ الطلب بعد المراجعة. الحسابات المخالفة قد تُعلَّق منّا مباشرة.
        </p>
      </LegalSection>

      <LegalSection title="الإشراف">
        <p>
          نستخدم أدوات تلقائية ومراجعة بشرية عند البلاغ. إزالة المحتوى أو تقييد الحساب قرار تشغيلي لحماية المستخدمين
          والامتثال. تكرار المخالفة سبب لإنهاء الحساب.
        </p>
      </LegalSection>

      <LegalSection title="English summary">
        <p>
          Lahza hosts user-generated content. Sexual content involving minors, harassment, hate, graphic violence,
          fraud, impersonation, gift abuse, and privacy violations are banned. Report abuse to {LEGAL_CONTACT} with a
          username or link. Hosts and appointed moderators may mute, kick, or ban in a room. We review serious reports
          promptly and may suspend accounts. Published contact: {LEGAL_CONTACT}.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
