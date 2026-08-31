import type { Metadata } from "next";
import { LEGAL_CONTACT, LegalPage, LegalSection } from "../_components/legal-page";

export const metadata: Metadata = {
  title: "شروط الاستخدام — لحظة",
  description: "شروط استخدام تطبيق وموقع لحظة، بما في ذلك المحتوى والمشتريات والبث.",
};

export default function TermsPage() {
  return (
    <LegalPage title="شروط الاستخدام" titleEn="Terms of Use">
      <LegalSection title="القبول">
        <p>
          باستخدامك تطبيق أو موقع «لحظة» فأنت توافق على هذه الشروط وسياسة الخصوصية ومعايير المجتمع. إن لم توافق فلا
          تستخدم الخدمة.
        </p>
      </LegalSection>

      <LegalSection title="الأهلية">
        <p>
          إنشاء الحساب يتطلب بريدًا صالحًا. الشراء وإرسال الهدايا وطلب سحب الأرباح لمن أتمّ 18 عامًا. أنت مسؤول عن دقة
          بياناتك وعن جهازك وجلستك.
        </p>
      </LegalSection>

      <LegalSection title="حسابك">
        <p>
          اسم المستخدم والاسم الظاهر جزء من هويتك في الخدمة. لا تنتحل شخصية غيرك ولا تشارك كلمة المرور. يمكننا تعليق
          أو إنهاء حساب يخالف الشروط أو يسيء للأمان. يمكنك حذف الحساب من الإعدادات في أي وقت.
        </p>
      </LegalSection>

      <LegalSection title="المحتوى الذي تنشره">
        <p>
          تبقى مالكًا لمحتواك. تمنح «لحظة» ترخيصًا محدودًا غير حصري لعرضه وتشغيله داخل الخدمة (بما في ذلك البث
          والتعليقات واللحظات والخريطة). لا تنشر ما تنتهك به حقوق غيرك أو القانون. يمكننا إزالة المحتوى المخالف.
        </p>
      </LegalSection>

      <LegalSection title="البث والغرف الصوتية">
        <p>
          صاحب البث أو الغرفة يدير غرفته، ويمكنه تعيين مشرفين بصلاحيات كتم وطرد وحظر. الطرد يُخرجك دون منع دائم.
          الحظر يمنع العودة حتى يُرفع. الكتم يمنع التعليق وطلب المايك. إساءة استخدام هذه الأدوات قد تُراجع منّا.
        </p>
      </LegalSection>

      <LegalSection title="اللمعات والمشتريات">
        <p>
          اللمعات وحدات افتراضية استهلاكية للهدايا والتفاعل داخل التطبيق. سعر العرض الظاهر يأتي من متجر أبل بعد الربط،
          أو من صفحة الدفع عند الشحن عبر الويب. اللمعات ليست نقدًا ولا سهمًا ولا تُسترد كرصيد بنكي بعد التسليم، إلا
          حيث يُلزم نظام حماية المستهلك أو سياسة أبل. الشراء من متجر أبل يخضع لشروط أبل؛ الاستعادة تنطبق على المشتريات
          غير المسلّمة وفق آلية التحقق لدينا، لا على وحدات أُنفقت كهدايا.
        </p>
      </LegalSection>

      <LegalSection title="أرباح المذيع">
        <p>
          الهدايا قد تولّد أرباحًا للمذيع وفق الشريحة المعلنة لذلك الشهر، بعد حصة المتجر إن وُجدت. الأرباح ليست تحويلًا
          فوريًا للنقد. السحب يخضع للأهلية والتحقق ووسيلة الدفع والمقاصة والمراجعة، وقد يبقى طلب السحب معلّقًا حتى
          التنفيذ اليدوي أو عبر المزوّد. مخالفة أو تلاعب قد تجمّد الصرف.
        </p>
      </LegalSection>

      <LegalSection title="السلوك المحظور">
        <p>
          يُحظر الاحتيال، التلاعب بالهدايا أو الحسابات المرتبطة، الإساءة، المحتوى الجنسي الذي يشمل قاصرين، التحريض على
          العنف، وانتهاك الخصوصية. نطبّق الإزالة والكتم والحظر وإنهاء الحساب عند اللزوم.
        </p>
      </LegalSection>

      <LegalSection title="الإخلاء والمسؤولية">
        <p>
          الخدمة تُقدَّم كما هي. البث يعتمد على الشبكة وأطراف ثالثة وقد ينقطع. لا نضمن دخلًا من البث. مسؤوليتنا محدودة
          بأكبر قدر يسمح به النظام المعمول به.
        </p>
      </LegalSection>

      <LegalSection title="القانون">
        <p>تخضع هذه الشروط لأنظمة المملكة العربية السعودية، مع حفظ حقوقك غير القابلة للتنازل حيث تقيم.</p>
      </LegalSection>

      <LegalSection title="التواصل">
        <p>{LEGAL_CONTACT}</p>
      </LegalSection>

      <LegalSection title="English summary">
        <p>
          Using Lahza means you accept these terms, the privacy policy, and community standards. Purchases, gifts, and
          withdrawals are for users 18+. You own your content and grant us a limited license to display it in the app.
          Hosts may appoint moderators who can mute, kick (temporary), or ban. Lum’at (coins) are consumable virtual
          items with no cash value after delivery except where law or Apple requires otherwise. Host earnings from
          gifts are not an instant cash-out and follow eligibility, review, and payout rules. We may remove violating
          content or accounts. Governed by the laws of the Kingdom of Saudi Arabia. Contact {LEGAL_CONTACT}.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
