-- lahza-test7-age.sql
-- حساب اختبار معزول فقط — لا تشغّل على حساب حقيقي.
-- user: lahza.test7.4eedcf5a7d@example.com
-- id: 486360ae-0a0c-4615-803e-9cbd7cb5fb74

update auth.users
set
  created_at = now() - interval '20 days',
  updated_at = now() - interval '20 days'
where id = '486360ae-0a0c-4615-803e-9cbd7cb5fb74'
  and email = 'lahza.test7.4eedcf5a7d@example.com';

-- تحقق سريع
select id, email, created_at, now() - created_at as age
from auth.users
where id = '486360ae-0a0c-4615-803e-9cbd7cb5fb74';
