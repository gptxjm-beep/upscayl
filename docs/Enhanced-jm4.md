# Upscayl Enhanced 2.15.0-jm.4 — Recovery UX

## السلوك

- تبقى واجهة Upscayl الأصلية وبطاقة STOP / PAUSE في مكانهما. لا تتغير بوابة jm.3 أو سعة الطوابير أو تداخل التحميل والمعالجة والحفظ.
- بعد الإغلاق غير المتوقع تظهر نافذة استعادة داخل التطبيق، تتضمن المجلد والتقدم والإعدادات السابقة. **Resume Processing** يستعيد الإعدادات المحفوظة؛ **Not Now** يغلق التذكير فقط.
- عند اختيار المجلد مجددًا تظهر مقارنة الإعدادات الحالية والسابقة. **Resume Previous Session** يكمل السابقة. **Start Fresh with Current Settings** ينشئ جلسة ومجلد نتائج جديدين بالإعدادات الحالية، ثم يُبطل سجل الجلسة القديمة ويحذف بياناتها المؤقتة؛ تبقى صورها النهائية. **Cancel** لا يغير السجل.
- الأزرار تتعطل فور النقر وتعرض مؤشر انتظار. تبقى نافذة الاستعادة حتى يؤكد المحرك بدء المعالجة؛ فشل البدء يُبقي النافذة والسجل للمحاولة مجددًا.
- **STOP** يعرض تأكيدًا داخل التطبيق. **Go Back** هو الخيار الافتراضي. **Stop Task** يلغي إمكانية استكمال هذه الجلسة ويحتفظ بصورها المكتملة. Single / Double يحتفظان بسلوك STOP الأصلي.
- الإغلاق العادي عبر X ينتظر توقف المحرك وحفظ النتائج كما في jm.3، ويضع علامة إغلاق سليم؛ لا تظهر له نافذة استعادة عند بدء التطبيق، لكنه يظل قابلًا للاستعادة عند اختيار مجلده. الجلسة القديمة التي تحمل Paused دون علامة إغلاق لا تُعد وحدها دليلًا على انهيار سابق.
- يدعم استعادة سجل jm.3 بعد استبدال محرك Windows المعروف ذي SHA-256 `295f5bfaf0d4ecadd97e9f27b0270393d31e1d0d94dab09cdc47eb142021ce1c` بمحرك الإصدار الحالي. نقل المحرك/النماذج مسموح مع تطابق بصماتها؛ تغيير محرك غير معروف أو أوزان النماذج يوقف الاستعادة بأمان.

## الأخطاء والسجلات

رسالة مختصرة تتضمن اسم الصورة والسبب، مع **Technical details** مطوية و**Open Logs Folder**. لا تُعرض نسب تقدم المحرك في رسالة الخطأ.

الموقع: `%APPDATA%\Upscayl Enhanced\logs\`. يحتفظ النظام بآخر ثماني مجموعات سجلات جلسات، وملف أحداث عام؛ لكل ملف حد 256 KiB وأرشيف واحد. لا يحذف ملفات السجلات غير التابعة له. التسجيل للأحداث المهمة والأخطاء، وليس لكل صورة ناجحة. فشل القراءة/الكتابة والتعافي والتوقف يسجل بتفاصيل محدودة.

## تحقيق WIC — ما ثبت وما لم يثبت

أفاد المستخدم بصورة JPEG حجمها 8,536,025 بايت، وأبعاد معروضة 720×29,700، ونموذج Standard 4x وإخراج 2x PNG. الأبعاد المتوقعة للمعالجة 2,880×118,800، وللإخراج النهائي 1,440×59,400. لم تُرفق الصورة الأصلية، ولذلك لم يُتحقق من بياناتها أو إعادة إنتاج مسارها الكامل.

في اختبار مستقل على Windows Server 2022 باستخدام WIC الأصلي، نجح SetSize وكذلك WritePixels وCommit عند 1,440×59,400 PNG. فشل SetSize عند 2,880×118,800 بنفس `0x88982f51 / WINCODEC_ERR_IMAGESIZEOUTOFRANGE`. ونجح ارتفاع 65,535 وفشل 65,536 عند عرض 1,440. اختبار ترتيب SetPixelFormat قبل/بعد SetSize أعطى النتيجة نفسها للحالتين الأساسيتين. هذه ملاحظات على مُرمز النظام المختبَر، وليست حدًا عامًا لصيغة PNG أو ضمانًا لمُرمز Windows 11 على جهاز المستخدم.

لا تثبت هذه النتائج أن Pause سبب الخطأ أو أن الأبعاد الوسيطة أُرسلت فعلًا للمُرمز في الحالة المبلغ عنها. المصدر يستدعي تغيير الحجم قبل الترميز عند اختلاف المقياس. أُضيف تسجيل عند الفشل يتضمن اسم الصورة وأبعاد الإدخال والمعالجة والإخراج النهائي ونوع المُرمز وHRESULT، كما يحتفظ الحدث المنظم بكود HRESULT نفسه.

عُثر أيضًا على تخصيص مخزن تغيير الحجم باستخدام malloc دون تحريره عند انتهاء Mat الخارجي. استُبدل بمخزن يملكه Mat مع فحص الأبعاد والتخصيص ونجاح تغيير الحجم. بقيت خوارزمية تغيير الحجم وبوابة Pause كما هما. هذا إصلاح مستقل لتسرب ذاكرة قابل للاستنتاج من المصدر؛ لا يُدّعى أنه سبب خطأ الصورة المعينة.

لإعادة اختبار مُرمز جهازك دون GPU، حمّل ملف WIC-dimension-diagnostics من Workflow التشخيص، واستخرج الملفات، ثم شغل من PowerShell:

```powershell
.\wic-dimensions.exe | Tee-Object .\wic-on-my-windows.txt
(Get-Item "$env:WINDIR\System32\WindowsCodecs.dll").VersionInfo | Format-List FileVersion,ProductVersion
```

شارك ملف النص وسجل الخطأ الجديد وأبعاد الصورة من Details وإعدادات المقياس/النموذج. لا يلزم مشاركة الصور الأصلية الحساسة.

## التحقق

- TypeScript وبناء Next.js والتحقق من مخططات الترجمة.
- اختبارات سجل المهمة: Pause/Resume، الاستعادة بعد قتل المضيف في مراحل الكتابة المختلفة، عدم الكتابة فوق صور سابقة، الإلغاء، البدء الجديد بالإعدادات الحالية، علامات الإغلاق، نقل المحرك المطابق، والسجلات/نوافذ التأكيد.
- اختبارات Electron للواجهة مع حالات مصطنعة: Settings، موضع STOP/PAUSE، انتظار Resume الفوري، الاستعادة والتأكيد والمحاولة بعد الفشل وعرض صغير.
- اختبارات NCNN فعلية باستخدام SwiftShader (Vulkan برمجي على CPU): المعالجة والبوابة والاستعادة والتحقق من الأبعاد. ليست Benchmark ولا اختبار RTX.
- Workflow Windows يبني المحرك من المصدر، ويختبر WIC وElectron ثم يتحقق من محتويات EXE وZIP وبصماتها وهوية Enhanced المستقلة وتعطيل التحديثات. نجاحه وحده لا يثبت صحة Pause على GPU حقيقي.
- عائق محلي معروف: Sharp/libvips تحت Electron Linux ينهار في مسار metadata؛ Node وNCNN واختبارات الواجهة المستقلة تعمل. اختبار Electron الكامل للاستعادة يُجرى على Windows المستهدف.

## تجربة Windows 11 / RTX 3060 Ti

ثبّت Enhanced بجانب الأصلي، أو استخرج ZIP في مجلد مستقل. استخدم أولًا نسخة من مجموعة صغيرة ثم 50–100 صورة، بينها صفحات طويلة وPNG/JPEG ومسارات عربية.

1. Pause أثناء المعالجة: تظهر Pausing؛ انتظر Paused وخروج عملية المحرك قبل الحكم على تحرير الموارد. Resume يجب أن يعرض الانتظار فورًا ويكمل الصور غير المكتملة.
2. أغلق X أثناء المعالجة: انتظار التوقف الآمن ثم إغلاق. افتح التطبيق؛ لا تذكير انهيار، واختيار المجلد يعرض استعادته.
3. اختبر إنهاء التطبيق من Task Manager على مجموعة تجريبية: عند الفتح يظهر تذكير الاستعادة. Not Now ثم اختيار المجلد يجب أن يحافظ على التقدم.
4. بدّل النموذج أو المقياس، ثم اختر المجلد القديم: راجع مقارنة الإعدادات؛ الاستعادة تستخدم السابقة، والبدء الجديد يستخدم الحالية في مجلد منفصل دون تغيير صور الجلسة القديمة.
5. STOP ثم Go Back لا يلغي العمل؛ تأكيد Stop Task يُنهي الاستكمال ويحفظ النتائج المكتملة.
6. أعد حالة الصورة الطويلة. شارك سجل encode الجديد إذا فشلت. لا يُستنتج تحسن الأداء أو خلو الذاكرة من مجرد ظهور Paused.

لا دمج إلى main ولا نشر إصدار رسمي، ولا قياسات أداء أو ادعاء نجاح على RTX ضمن هذه البيئة.

## نتائج التحقق المحلي

نجحت اختبارات الجلسات والوحدات الـ36، واختبارات NCNN الفعلية الخمسة على SwiftShader، واختبار C++ للبوابة، وبناء TypeScript/Next.js، واختبارات واجهة Electron. تشمل الواجهة أيضًا الإلغاء قبل إنشاء السجل وعدم تطبيق استجابة قديمة لاستعلام الحالة فوق تحديث أحدث. اختبارات GPU الحقيقي وWindows 11 على جهاز المستخدم تبقى عملية منفصلة.

## الملفات المعدلة في هذه المرحلة

```text
.github/workflows/build-enhanced-windows.yml
.github/workflows/wic-dimensions.yml
common/electron-commands.ts
common/types/batch-ui.ts
docs/Enhanced-jm4.md
electron/commands/stop.ts
electron/index.ts
electron/jobs/failure.ts
electron/jobs/integration.ts
electron/jobs/log.ts
electron/jobs/manager.ts
electron/jobs/prompts.ts
renderer/atoms/batch-prompt-atom.ts
renderer/atoms/batch-settings-atom.ts
renderer/atoms/job-atom.ts
renderer/components/hooks/use-batch-job.ts
renderer/components/main-content/batch-error.tsx
renderer/components/main-content/batch-prompts.tsx
renderer/components/main-content/progress-bar.tsx
renderer/locales/ar.json
renderer/locales/ca-val.json
renderer/locales/de.json
renderer/locales/en.json
renderer/locales/es.json
renderer/locales/fr.json
renderer/locales/hu.json
renderer/locales/id.json
renderer/locales/it.json
renderer/locales/ja.json
renderer/locales/ms.json
renderer/locales/pl.json
renderer/locales/pt-br.json
renderer/locales/pt.json
renderer/locales/ru.json
renderer/locales/th.json
renderer/locales/tr.json
renderer/locales/uk.json
renderer/locales/vi.json
renderer/locales/zh.json
renderer/pages/index.tsx
tests/jobs/recovery-dialogs.cjs
tests/jobs/recovery-ui.cjs
tests/jobs/recovery-ux.test.cjs
tests/jobs/session.test.cjs
tests/jobs/ui.smoke.cjs
tests/jobs/wic-dimensions.cpp
tests/jobs/wic.cpp
tools/enhanced-builder.cjs
tools/verify-enhanced-windows.py
vendor/upscayl-ncnn/src/main.cpp
vendor/upscayl-ncnn/src/wic_image.h
```
