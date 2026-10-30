import { DEFAULT_MONTHLY_PRICE_SAR } from "../domain/subscription";

export const texts = {
  sellerWelcome: `هلا والله 👋
هذا بوت MAD AI لعرض حسابات ببجي.

تبي تعرض؟ اضغط «إي» أو أرسل فيديو/صور الحساب مع الوصف والسعر.
تبي تسأل عن إعلان؟ اكتب رقمه مثل A123 موجود؟ أو حوّل رسالة القناة.

الإعلان ينزل باسم المالك فقط — ما يظهر يوزرك.`,

  ownerWelcome: `هلا، أنا MAD AI وكيل متجرك 👋
تكلمني عادي وأنا أفهمك:

• أبي أبيع / أرسل فيديو أو صور الحساب
• كم إعلان عندي؟
• وش آخر الاستفسارات؟
• غيّر الرسوم / الإعدادات
• الإحصائيات

وللسكرم اكتب: افتح سكرم`,

  startYes: "إي، خلنا نبدأ",
  startNo: "لا، تراجع",
  later: "تمام، متى ما تبي تعرض حساب أرسل /start أو فيديو الحساب.",

  /** DMSTOR: private MAD AI off; traders mirror still on. */
  privateAgentOff:
    "محادثات MAD AI الخاصة موقوفة لهذا البوت. نشر قروب التجار للقناة شغال كالعادة.",

  banned: "حسابك محظور، تواصل مع المالك.",
  askVideo: "تمام، أرسل فيديو الحساب الحين.",
  needVideo: "أرسل فيديو للحساب (مو صورة ولا نص). أو /cancel للإلغاء.",
  askFreeListing:
    "اكتب وصف الحساب بحرية في رسالة واحدة: اللفل، السكنات، الأسلحة، الربط، والسعر. لا تحط يوزرك ولا رقمك ولا رابط تواصل.",
  askDescription: "اكتب وصف الحساب: اللفل، السكنات، الأسلحة، وأي ملاحظة مهمة.",
  contactStripped: "شيلنا أي يوزر أو رقم أو رابط تواصل من الوصف. الإعلان ينزل باسم المالك فقط.",
  generalHelp:
    "تقدر تسأل باللهجة: تبحث عن حساب، تفرق مصطلحات السوق، أو تسجّل طلب نبلغك إذا نزل. أو أرسل فيديو أو /start للعرض، أو رقم مثل A123 موجود؟",
  needListingNumber: "أرسل رقم الإعلان مثل A123، أو حوّل رسالة الإعلان من القناة.",
  sellerMarkedSold: (code: string) => `تم. حدّثنا ${code} إلى تم البيع ✅`,
  needDescription: "الوصف لازم يكون نص. اكتب وصف الحساب أو /cancel.",
  askPrice: "كم السعر؟ اكتب الرقم بالريال (مثال: 150).",
  needPrice: "ما فهمت السعر. اكتب رقم واضح مثل 150 أو /cancel.",
  askBinding: "وش الربط؟ (جوجل، فيس، تويتر...) أو أرسل تفاصيل الربط.",
  needBinding: "أرسل الربط كنص، أو اكتب «بدون» إن ما فيه. أو /cancel.",

  previewHint:
    "هذه معاينة الإعلان. في القناة ما يظهر إلا يوزر المالك. اختر: نشر، تعديل، أو إلغاء.",
  useButtons: "استخدم الأزرار تحت المعاينة: نشر / تعديل / إلغاء.",
  editWhat: "وش تبي تعدل؟",
  published: (code: string) =>
    `تم النشر في القناة ✅\nرقم الإعلان: ${code}\nإذا انباع الحساب، المالك يستخدم /sold ${code}`,
  duplicateUpdated: (code: string, price: string) =>
    `هذا الحساب نازل من قبل برقم ${code}. حدّثنا السعر إلى ${price} ريال بدل إعلان مكرر.`,
  rateLimited: "تراك مسرع. انتظر شوية وحاول مرة ثانية.",
  bannedOk: (id: string) => `تم حظر البائع ${id}.`,
  unbannedOk: (id: string) => `فكينا الحظر عن ${id}.`,
  needBanTarget: "استخدم كذا: /ban A123 أو /ban 123456789",
  auditEmpty: "ما فيه عمليات مسجّلة بعد.",
  auditTitle: "آخر العمليات:",
  askReceipt: (fee: string, instructions: string) =>
    `رسوم الإعلان لهذا المتجر ${fee} ريال.\n${instructions || "حوّل المبلغ للمالك، وإذا ما عندك رقم التحويل اسأله خاص."}\nبعد التحويل أرسل صورة الإيصال هنا.`,
  needReceipt: "أرسل صورة إيصال التحويل، أو /cancel.",
  receiptSent: (code: string) =>
    `وصل الإيصال للمالك لإعلان ${code}. نبلغك أول ما يعتمد وينشر.`,
  receiptOwnerCaption: (code: string, amount: string, sellerId: string) =>
    `إيصال رسوم إعلان ${code}\nالمبلغ: ${amount} ريال\nالبائع (مخفي عن الزبائن): <code>${sellerId}</code>`,
  paymentConfirmed: "تم تأكيد الإيصال، ونُشر الإعلان.",
  paymentRejected: "تم رفض الإيصال.",
  sellerPaymentRejected: (code: string) =>
    `المالك رفض إيصال ${code}. أرسل صورة إيصال أوضح، أو /cancel للإلغاء.`,
  cancelled: "تم الإلغاء، ما نُشر شيء.",
  notOwner: "هذا الأمر للمالك فقط.",
  soldOk: (code: string) => `تم تحديث ${code} إلى تم البيع ✅`,
  deletedOk: (code: string) => `تم حذف ${code} من القناة.`,
  needCode: (cmd: string) => `استخدم كذا: /${cmd} A123`,
  help: `الأوامر:
/start — عرض حساب
/cancel — إلغاء العملية الحالية
للمشتري: اسأل باللهجة، أو A123 موجود؟ أو حوّل إعلان القناة
للمالك: اكتب بالعامية، أو /stats /settings /setup /sync_channel /reset /sold /delete /scrim /scrim_settings
لمالك المنصة: /admin`,

  pickStore: "اختر القناة اللي تبي تنزل فيها الإعلان:",
  noStores: "ما فيه متاجر مسجّلة بعد. المالك يستخدم /setup.",
  storeWelcome: (title: string) =>
    `هلا 👋
متجر ${title} على MAD AI.

تبي تعرض حساب؟ اضغط «إي» أو أرسل فيديو/صور الحساب. الإعلان ينزل هنا باسم المالك فقط.`,
  listingForStore: (title: string) => `بننزل الإعلان في متجر: ${title}`,
  unknownStore: "رابط المتجر هذا مو صحيح أو المتجر انحذف.",
  sellerInvite: (url: string) =>
    `رابط دخول البائعين لهذا المتجر:\n${url}\n\nاللي يفتحه ينربط بهالقناة، وإعلاناته تنزل هنا.`,
  setupAskChannel: `اربط قناتك أو مجموعتك بأحد هالطرق:
1) اضغط «👥 اختيار مجموعة» أو «📢 اختيار قناة» تحت — الأسهل، وتقدر تضيف البوت مشرف من هناك.
2) حوّل رسالة من القناة أو المجموعة هنا.
3) أرسل اليوزر مثل @mystore أو رابط t.me أو الآيدي -100…
4) للمجموعات: ضيف البوت مشرف، واكتب /bind داخل المجموعة نفسها.

إذا منع إعادة التوجيه مفعّل، التحويل ما يعطينا المصدر — استخدم الزر أو أرسل اليوزر.`,
  setupNeedChannel:
    "ما قدرت أتعرف على القناة أو المجموعة من هالرسالة. أرسل يوزر مثل @mystore، أو رابط t.me، أو الآيدي -100…، أو اضغط زر الاختيار. أو /cancel.\nوللمجموعة تقدر تكتب /bind داخلها.",
  setupHiddenForward:
    "التحويل وصل، لكن تلقرام ما أرسل بيانات القناة (غالبًا لأن منع إعادة التوجيه مفعّل أو المصدر مخفي).\nأرسل يوزر القناة مثل @mychannel، أو رابطها، أو اضغط «اختيار القناة».",
  setupUserForward:
    "هذي رسالة محوّلة من شخص، فما تبيّن المجموعة أو القناة. أرسل يوزرها أو رابطها، أو اضغط زر الاختيار، أو اكتب /bind داخل المجموعة نفسها.",
  setupGroupNotChannel:
    "هذي رسالة من قروب (أو قروب المناقشة المربوط بالقناة)، مو من القناة نفسها.\nافتح القناة ← اختر أي منشور ← «إعادة توجيه» ← أرسله هنا.\nأو أرسل يوزر القناة مثل @mychannel، أو اضغط «اختيار القناة».",
  setupBotNotAdminSteps: (detail: string) =>
    `${detail}\n\nالخطوات:\n1) افتح القناة ← الإعدادات ← المشرفين ← إضافة مشرف.\n2) ابحث عن يوزر هذا البوت واختاره.\n3) فعّل صلاحية «نشر الرسائل» (وتعديل/حذف الرسائل).\n4) احفظ، ثم أرسل القناة هنا مرة ثانية.`,
  setupBotNotGroupAdminSteps: (detail: string) =>
    `${detail}\n\nالخطوات:\n1) افتح المجموعة ← اسمها فوق ← تعديل ← المشرفين ← إضافة مشرف.\n2) اختر هذا البوت.\n3) فعّل «حذف الرسائل» و«تثبيت الرسائل»، وتأكد إن الأعضاء/البوت يقدرون يرسلون.\n4) احفظ، ثم اكتب /bind داخل المجموعة أو أرسلها هنا مرة ثانية.`,
  bindGroupOnly: "/bind يشتغل داخل المجموعة نفسها. بالخاص استخدم /setup.",
  bindAnonymous:
    "أنت مرسل كـ«مشرف مجهول»، فما أقدر أتحقق منك. طفّ خيار «البقاء مجهولاً» من صلاحياتك بالمجموعة مؤقتًا، أو اربطها من الخاص بـ /setup.",
  bindNotGroupAdmin: "لازم تكون مشرف أو مالك هالمجموعة عشان تربطها.",
  bindGroupMigrated: (id: string) => `المجموعة صارت سوبر قروب، وحدّثت ربط المتجر للآيدي الجديد ${id} ✅`,
  setupChannelTaken:
    "هالقناة/المجموعة مربوطة بمتجر ثاني على المنصة، فما أقدر أربطها هنا.\nإذا القناة حقتك وتبي تنقلها، كلّم مالك المنصة يفك ربطها من المتجر الثاني، أو أرسل قناة ثانية.",
  setupTrialUsed:
    "هالقناة/المجموعة استخدمت التجربة المجانية قبل، فما ينعاد التجريب عليها.\nتقدر تربطها بعد تجديد الاشتراك (من /settings ← «تجديد الاشتراك»)، أو تكلّم مالك المنصة.",
  setupNotChannel: "هذي محادثة خاصة. أرسل قناة أو مجموعة.",
  setupChannelNotFound:
    "ما لقيت هالقناة/المجموعة. تأكد من اليوزر أو الرابط، وإن البوت مضاف فيها. المجموعات الخاصة بدون يوزر: ضيف البوت واكتب /bind داخلها.",
  setupBotNotAdmin: (missing: string) =>
    missing
      ? `البوت لازم يكون أدمن ويقدر ينشر.\nالصلاحية الناقصة: ${missing}.`
      : "البوت لازم يكون أدمن في القناة ويقدر ينشر.",
  setupAskTitle: "وش اسم المتجر اللي يظهر لك في الإعدادات؟",
  setupNeedTitle: "أرسل اسم المتجر كنص، أو /cancel.",
  setupAskUsername: (suggested: string) =>
    `يوزر المالك اللي يظهر في الإعلان؟ أرسله بدون @ (مثال: ${suggested})`,
  setupNeedUsername: "أرسل اليوزر بدون @، أو /cancel.",
  setupAskFee: "رسوم الإعلان بالريال؟ 0 = مجاني وينشر فورًا.",
  setupNeedFee: "أرسل رقم الرسوم مثل 0 أو 15، أو /cancel.",
  setupDone: (title: string, channelId: string, fee: string) =>
    `تم تسجيل المتجر ✅\n${title}\nالقناة: ${channelId}\nالرسوم: ${fee} ريال`,
  setupChannelBound: (title: string, channelId: string, reusedTrial: boolean, chatType?: string) =>
    reusedTrial
      ? `انربطت ${chatType && chatType !== "channel" ? "المجموعة" : "القناة"} ${channelId} بمتجر ${title}. التجربة استُخدمت من قبل لهذا المالك، فالخدمة تحتاج تجديد اشتراك (${DEFAULT_MONTHLY_PRICE_SAR} ريال / 30 يوم) من /settings.`
      : `انربطت ${chatType && chatType !== "channel" ? "المجموعة" : "القناة"} ${channelId} بمتجر ${title} ✅\nالتجربة المجانية شغّالة. الإعلانات تنزل هنا باسمك.`,
  storeBindHint:
    "تمام، خلنا نربط القناة أو المجموعة.\nاضغط الأزرار تحت أو حوّل رسالة من القناة/المجموعة، أو اكتب /bind داخل المجموعة بعد ما تضيف البوت مشرف.",
  storeUnbindConfirm: (channelId: string) =>
    `متأكد تفك ربط ${channelId} عن هالمتجر؟\nبعد الفك ما ينشر شيء لين تعيد الربط (قل «اربط القناة» أو /setup، أو /bind داخل المجموعة).`,
  storeUnbindDone:
    "انفك الربط ✅\nلتعيد الربط: قل «اربط القناة» أو أرسل /setup بالخاص، أو اكتب /bind داخل المجموعة بعد ما البوت يكون مشرف.",
  storeUnbindNone: "هالمتجر ما عنده قناة أو مجموعة مربوطة أصلًا. قل «اربط القناة» عشان نبدأ.",
  storeUnbindCancelled: "تمام، ما فكينا شيء.",
  serviceStopped: "الخدمة متوقفة مؤقتًا.",
  renewAskReceipt: (price: string, instructions: string) =>
    `تجديد الاشتراك: ${price} ريال لمدة 30 يوم.\n${instructions}\nبعد التحويل أرسل صورة الإيصال هنا.`,
  subscriptionReceiptSent: "وصل الإيصال لمالك المنصة. نبلغك أول ما يعتمد.",
  subscriptionConfirmed: (until: string) => `تم تأكيد الاشتراك ✅ صالح حتى ${until}`,
  subscriptionRejected: "انرفض إيصال الاشتراك. أرسل إيصال أوضح أو تواصل مع مالك المنصة.",
  adminOnly: "هذا الأمر لمالك المنصة فقط.",
  adminAskToken: "أرسل توكن البوت الجديد من BotFather (يبدأ برقم ثم :). ما نطبعه في السجلات.",
  platformMenu: `لوحة إدارة المنصة 🛠
من هنا تدير المتاجر بس (الإعلانات تكون داخل بوتات المتاجر).

تقدر تضغط الأزرار أو تكتب عادي، مثل:
• «ضيف بوت» أو الصق التوكن مباشرة
• «كم متجر عندي» / «وش حالة البوتات»
• «وقف متجر @اسم_البوت» / «شغل متجر …» / «احذف بوت …»
• «فك ربط القناة عن متجر …»
• «الإيصالات» / «عيّن أيام التفعيل لمتجر …»
• «اربط بوت سكرم لمتجر …»
• /admin لوحة كاملة · /cancel إلغاء`,
  platformNotUnderstood: "ما فهمت الطلب بالضبط 🙏",
  platformNoAds:
    "هذا بوت إدارة المنصة، وما ينشر إعلانات ولا يستقبل فيديوهات حسابات.\nلبيع حساب أو نشر إعلان استخدم بوت المتجر، مثل @Aramstoree_bot أو @Bootpubg_bot.",
  platformPublic:
    "هلا 👋 هذا بوت إدارة منصة المتاجر، خاص بمالك المنصة.\nتبي تبيع أو تشتري حساب؟ افتح بوت المتجر، مثل @Aramstoree_bot أو @Bootpubg_bot.",
  platformBindChannelHint:
    "ربط القناة أو المجموعة يصير من بوت المتجر نفسه:\n1) صاحب المتجر يضيف بوت المتجر مشرف بالقناة (نشر الرسائل) أو المجموعة (حذف الرسائل).\n2) يرسل /setup لبوت المتجر بالخاص، أو /bind داخل المجموعة.\nولفك الربط: اكتب «فك ربط القناة» أو اضغط الزر على كرت المتجر.",
  adminBadToken:
    "هذا ما يشبه توكن بوت. التوكن من BotFather شكله: 123456789:AAH...\nانسخه كامل وأرسله، أو /cancel.",
  adminAskExtendDays: "كم يوم تفعيل؟ أرسل رقم مثل 30.",
  adminAskActivationDays: "كم يوم تفعيل لهذا البوت؟ أرسل رقم مثل 30.",
  adminStoreAdded: (username: string) =>
    `تم ربط وتشغيل البوت @${username} ✅\n\nالخطوات الجاية لصاحب المتجر:\n1) يضيف @${username} مشرف في قناته (مع «نشر الرسائل») أو مجموعته (مع «حذف الرسائل»).\n2) يفتح @${username} ويرسل /start ثم /setup ويختار القناة/المجموعة — أو يكتب /bind داخل المجموعة.\n3) (اختياري) بوت سكرمات: /add_scrim_bot TOKEN داخل @${username}.`,
  subscriptionReminder: (until: string, price: string, instructions: string) =>
    `تذكير: اشتراك متجرك ينتهي ${until}.\nالتجديد ${price} ريال / 30 يوم.\n${instructions}\nمن /settings اضغط «تجديد الاشتراك» وأرسل الإيصال.`,
  settingsPick: "اختر متجر تبي تعدّل إعداداته:",
  settingsNeedStore: "ما عندك متاجر. استخدم /setup.",
  settingsCard: (
    title: string,
    channelId: string,
    username: string,
    fee: string,
    mode: string,
    sub: string,
    instructions: string,
    glossaryLine: string,
  ) =>
    `إعدادات <b>${title}</b>\nالقناة/المجموعة: <code>${channelId}</code>\nاليوزر: @${username}\nالرسوم: ${fee} ريال\nالنشر: ${mode}\nالاشتراك: ${sub}\nتعليمات التحويل: ${instructions || "—"}\nالمعجم: ${glossaryLine}`,
  settingsAskFee: "أرسل الرسوم الجديدة بالريال (0 = مجاني).",
  settingsAskUsername: "أرسل يوزر المالك الجديد بدون @.",
  settingsAskTitle: "أرسل اسم المتجر الجديد.",
  settingsAskInstructions: "أرسل تعليمات التحويل اللي تشوفها البائع.",
  settingsAskGlossary:
    "أرسل مصطلحات متجرك، سطر لكل مصطلح:\nالمصطلح = المعنى\nمثال: الجلدي = سكن محلي عندنا",
  settingsSaved: "تم حفظ الإعدادات.",
  buyerRequestSaved: "تم. سجّلت طلبك، وأبلغك أول ما ينزل إعلان يطابقه في هالقناة. التسليم عبر المالك فقط.",
  buyerListingMatch: (code: string, summary: string) =>
    `نزل إعلان يطابق طلبك: ${code}\n${summary}\n\nالتسليم والشراء عبر المالك فقط.`,
  agentUnclear:
    "ما فهمت قصدك تمام. تبي تبحث عن حساب، ولا تسأل عن إعلان برقم مثل A001، ولا أسجّل طلب وأبلغك إذا نزل؟",
  statsPick: "اختر متجر للإحصائيات:",

  sellerInquiryAsk: (code: string) =>
    `فيه زبون يسأل عن حسابك ${code}، موجود ولا انباع؟ وكم السعر النهائي؟`,
  sellerInquiryReminder: (code: string) =>
    `تذكير: فيه زبون ينتظر ردك على ${code}\nالحساب موجود؟ وكم آخر سعر؟`,
  sellerAskLastPrice: "تمام، كم آخر سعر؟ اكتب الرقم بالريال.",
  sellerAvailableAck: (code: string, price: string) =>
    `تم. بلّغنا المشتري أن ${code} موجود وآخر سعر ${price} ريال، وحوّلناه للمالك.`,
  sellerSoldAck: (code: string) => `تم تحديث ${code} إلى تم البيع ✅ وبلّغنا المشتري.`,
  sellerInquiryGone: "هذا الاستفسار انتهى أو مو لك.",
  sellerNeedPrice: "اكتب السعر رقم واضح مثل 150، أو /cancel.",

  buyerChecking: (code: string) =>
    `لحظة، أتأكد من المعلن عن ${code} وأرجع لك.`,
  buyerAvailable: (code: string, price: string) =>
    `موجود ✅\nآخر سعر لـ ${code}: ${price} ريال\n\nالتسليم والشراء عبر المالك فقط. اضغط الزر تحت.`,
  buyerSold: (code: string) =>
    `للأسف الحساب ${code} انباع حسب المعلن.\nإذا تبي حساب ثاني تواصل مع المالك.`,
  buyerTimeout: (code: string) =>
    `ما وصلنا رد من جهة الإعلان ${code} خلال المهلة.\nتواصل مع المالك يتابع لك.`,
  buyerAlreadyWaiting: (code: string) =>
    `قاعدين نتحقق من ${code}، أول ما يجي الرد نبلغك.`,
  buyerOwnListing: "هذا إعلانك 👍 تبي تعدّل سعره؟ اكتب مثلاً: عدل السعر 2400",
  buyerNotPublished: (code: string, reason: string) => `الإعلان ${code}: ${reason}`,
  buyerNotFound: "ما تعرّفت على الإعلان. أرسل رقمه مثل A123 موجود؟ أو حوّل رسالة القناة.",

  ownerInquiryAvailable: (
    shortCode: string,
    price: string,
    buyerBlock: string,
    sellerBlock: string,
    description: string,
  ) =>
    `زبون يبي الحساب <b>${shortCode}</b>\nآخر سعر: <b>${price}</b> ريال\n\n<b>المشتري</b>\n${buyerBlock}\n\n<b>البائع</b>\n${sellerBlock}\n\n<b>الإعلان</b>\n${description}`,
  ownerInquiryTimeout: (shortCode: string, buyerBlock: string, sellerBlock: string) =>
    `البائع ما رد على استفسار <b>${shortCode}</b> بعد التذكير.\n\n<b>المشتري</b>\n${buyerBlock}\n\n<b>البائع</b>\n${sellerBlock}`,
  ownerSellerUnreachable: (shortCode: string, buyerBlock: string, sellerBlock: string) =>
    `ما قدرنا نوصل للبائع بخصوص <b>${shortCode}</b>. حوّلنا المشتري لك.\n\n<b>المشتري</b>\n${buyerBlock}\n\n<b>البائع</b>\n${sellerBlock}`,

  scrimGroupCard: (input: { tag: string; status: string; leader: string; needsReview: boolean }) =>
    `طلب تسجيل سكرم 📝\nالتاق: ${input.tag}\nالحالة: ${input.status}\nالقائد: ${input.leader}` +
    (input.needsReview ? "\n\nردّ على هالرسالة بـ «تم» للقبول أو «رفض»، أو استخدم الأزرار." : ""),
  scrimTeamStatusLabel: (status: string) =>
    ({
      PENDING_PROOF: "ينتظر مراجعة صورة التحقق",
      WAITING_COMMIT: "ينتظر «ملتزمين»",
      WAITLIST: "احتياط",
      CONFIRMED: "مؤكد",
      REJECTED: "مرفوض",
    })[status] ?? status,
  scrimGroupApproved: (by: string) => `✅ انقبل الفريق، قبله ${by}`,
  scrimGroupRejected: (by: string) => `❌ انرفض الفريق، رفضه ${by}`,
  scrimGroupNotOperator: "الموافقة للمالك والمشرفين بس.",
  scrimGroupSaved: "تمام، هذا القروب صار قروب المنظمين. طلبات التسجيل بتوصل هنا ✅",
  scrimGroupNeedAdmin: "لازم تخلّي البوت مشرف بالقروب أول، وبعدها أرسل /scrim_group مرة ثانية.",
  scrimGroupOnlyInGroup: "أرسل /scrim_group داخل قروب المنظمين نفسه (والبوت مشرف فيه). وللإلغاء: /scrim_group off",
  scrimGroupCleared: "شلنا قروب المنظمين. الطلبات بترجع توصلك بالخاص.",
  scrimRoomChannelNotice: (index: number) => `🔒 انرسل آيدي وباس الروم ${index} للفرق المؤكدة بالخاص.`,

  scrimDropsGroupSaved: (lead: number) =>
    `تمام، هذا صار قروب تحديد النزلات 🗺️\nقفلته الحين، ويفتح تلقائي قبل السكرم بـ ${lead} دقيقة ويتقفل وقت البداية.\nالفرق تكتب: اسم_الفريق | E:5 M:8`,
  scrimDropsGroupNeedAdmin: "لازم البوت يكون مشرف بالقروب ومعه صلاحية «تقييد الأعضاء»، وبعدها أرسل /scrim_drops_group مرة ثانية.",
  scrimDropsGroupOnlyInGroup: "أرسل /scrim_drops_group داخل قروب النزلات نفسه (والبوت مشرف فيه). وللإلغاء: /scrim_drops_group off",
  scrimDropsGroupCleared: "شلنا قروب النزلات.",
  scrimDropsOpened: "🟢 انفتح تحديد النزلات!\nاكتبوا: اسم_الفريق | E:رقم M:رقم (من 1 إلى 20)\nE = إرانغل · M = ميرامار · اللي يسبق ياخذ.",
  scrimDropsClosed: "🔴 انقفل تحديد النزلات. بالتوفيق للجميع 🔥",
  scrimDropsRange: "أرقام النزلات من 1 إلى 20 بس. مثال: TEAM | E:5 M:8",
  scrimDropsNoScrim: "ما فيه سكرم جاري الحين.",
  scrimDropsNotRegistered: (team: string) => `فريق «${team}» مو مسجّل ومؤكد بالسكرم الحالي.`,
  scrimDropsTaken: (map: string, n: number, owner: string) => `نزلة ${map} ${n} مأخوذة لـ ${owner}، غيّرها`,
  scrimDropsSame: (picks: string) => `نزلاتكم مسجّلة من قبل: ${picks}\nإذا تبي تغيّر، أرسل نزلة جديدة وتنشال القديمة.`,
  scrimDropsChanged: (tag: string, picks: string) => `تم تعديل نزلات ${tag}: ${picks}`,
  scrimRemind30: (time: string) => `⏰ باقي 30 دقيقة على السكرم (${time}). جهّزوا فريقكم وكونوا جاهزين.`,
  scrimRemind5: (input: { creds: string; drops: string }) =>
    `⏰ باقي 5 دقايق على السكرم!` +
    (input.creds ? `\n\n${input.creds}` : "\n\nالآيدي والباس يوصلكم أول ما ينزل.") +
    (input.drops ? `\n\nنزلاتكم: ${input.drops}` : ""),
  scrimScheduleHelp:
    "جدولة السكرم اليومي:\n/scrim_schedule 22:00 خليجي 16 3\n(الوقت بتوقيت السعودية، النوع، عدد الفرق من 10 إلى 25، عدد الرومات)\nوتقدر تضيف «فتح 180» = يفتح التسجيل قبل البداية بكم دقيقة.\nللإيقاف: /scrim_schedule off",
  scrimScheduleShow: (s: { time: string; kind: string; maxTeams: number; rooms: number; lead: number }) =>
    `✅ السكرم المجدول: كل يوم الساعة ${s.time} (بتوقيت السعودية)\nالنوع: ${s.kind} · ${s.maxTeams} فريق · ${s.rooms} روم\nالتسجيل يفتح تلقائي قبلها بـ ${s.lead} دقيقة.\nللإيقاف: /scrim_schedule off`,
  scrimScheduleOff: "وقفنا السكرم المجدول.",
  scrimScheduleNoChannel: "حان وقت فتح السكرم المجدول بس ما فيه قناة أو مجموعة مربوطة. اربطها من /setup أو /bind داخل المجموعة.",
  scrimScheduleOpened: (kind: string, time: string) => `انفتح تسجيل السكرم المجدول (${kind}) الساعة ${time} تلقائي ✅`,

  scrimBotWelcome: "هلا 👋 هذا بوت السكرمات.\nللتسجيل اضغط زر «سجّل فريقك» من إعلان السكرم بالقناة.",
  scrimBotUsage:
    "أرسل: /add_scrim_bot TOKEN\n(توكن بوت جديد من BotFather مخصص للسكرمات، مو توكن هذا البوت). التوكن شكله: 123456789:ABC... ورسالتك تنحذف تلقائي.",
  scrimBotAttached: (username: string) =>
    `تم ربط بوت السكرمات @${username} ✅\nكل أوامر وتسجيل السكرمات صارت عليه.\nلا تنسى: ضيفه مشرف بالقناة وقروب المنظمين وقروب النزلات، وأرسل /scrim_group و /scrim_drops_group من جديد داخل القروبات.`,
  scrimBotDetached: "شلنا بوت السكرمات. السكرمات رجعت على هذا البوت.",

  tradersBindOk: (groupId: string) =>
    `تم ربط قروب التجار (${groupId}) ✅\nالإعلانات (صور/فيديو) بتننشر تلقائي على قناة المتجر بعد تنظيف التاق واسم التاجر.\nملاحظة: لازم البوت يكون بالقروب ويشوف الرسائل (مشرف أو خصوصية BotFather مطفأة)، ومشرف بقناة المتجر مع صلاحية النشر.`,
  tradersBindFail:
    "صار خطأ أثناء ربط قروب التجار. تأكد إن البوت مشرف وجرّب /bind_traders مرة ثانية.",
  tradersBindHint:
    "اربط قروب التجار كذا:\n1) ضيف البوت للقروب (ويفضّل مشرف، أو طفّ Privacy Mode من BotFather).\n2) داخل القروب أرسل /bind_traders\nللإلغاء من داخل القروب: /unbind_traders",
  tradersUnbindOk: "انفك ربط قروب التجار ✅ ما عاد ننسخ الإعلانات للقناة.",
  tradersUnbindNone: "ما فيه قروب تجار مربوط أصلًا.",
  tradersUnbindWrongGroup: (id: string) =>
    `هالقروب مو هو المربوط. القروب المربوط آيديه ${id}. أرسل /unbind_traders من داخله.`,

  syncChannelStart: "بدء مزامنة إعلانات القناة… قد تاخذ دقيقة. لا ترسل أوامر ثانية للحين.",
  syncChannelNeedOwnerDm:
    "افتح خاص مع البوت أول (أرسل /start) عشان نقدر نقرأ القناة عبر التحويل المؤقت.",
  syncChannelNoChannel: "ما فيه قناة مربوطة. اربطها بـ /setup أو /bind داخل المجموعة.",
  syncChannelOk: (r: {
    imported: number;
    updated: number;
    scanned: number;
    skipped: number;
    listingSeq: number;
    listingPrefix: string;
    highMessageId: number | null;
  }) =>
    `تم مزامنة القناة ✅\nممسوح: ${r.scanned} · مستورد: ${r.imported} · محدّث: ${r.updated} · متخطى: ${r.skipped}\nالتسلسل الحين: ${r.listingPrefix}${String(r.listingSeq).padStart(3, "0")} (prefix ${r.listingPrefix}, seq ${r.listingSeq})` +
    (r.highMessageId ? `\nآخر رسالة قُرأت: ${r.highMessageId}` : "") +
    `\nإذا ناقص إعلانات قديمة، حوّل آخر إعلان من القناة أو أرسل /sync_channel F1442 (آخر رقم عندك).`,
  syncChannelFail: (reason: string) => `ما تمت المزامنة: ${reason}`,
  syncChannelSeedOk: (code: string) => `ضبطنا البادئة/التسلسل من ${code}، ونبدأ المسح…`,
  syncChannelImportOne: (code: string, created: boolean) =>
    created ? `استوردنا الإعلان ${code} ✅` : `حدّثنا الإعلان ${code} ✅`,
  syncChannelHelp:
    "مزامنة إعلانات القناة القديمة عشان الوكيل يجاوب عليها:\n/sync_channel — مسح حديث للقناة\n/sync_channel F1442 — إذا تعرف آخر رقم\nأو حوّل رسالة إعلان من القناة بعد الأمر.",

} as const;
