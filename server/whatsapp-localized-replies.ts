import { formatINR } from "../src/lib/currency.ts";
import {
  compactDoctorBookButton,
  LOCALIZED_BUTTONS,
  localizeAppointmentStatus,
  localizeMedTiming,
  localizePersonOrClinicName,
  localizeRoomLabel,
  localizeSpecialtyLabel,
  localizeTimingLabel,
  type WhatsAppLangCode,
} from "./whatsapp-localization.ts";

export type BotReplyPayload = {
  content: string;
  buttons?: string[];
  media?: Record<string, unknown>;
};

function localizedGreetingHeader(
  lang: "hi" | "mr",
  isRegistered: boolean,
  firstName?: string
): string {
  const fName = firstName ? localizePersonOrClinicName(firstName, lang) : "";
  if (lang === "hi") {
    return isRegistered && fName ? `नमस्ते ${fName}! 🙏 ` : "";
  }
  return isRegistered && fName ? `नमस्कार ${fName}! 🙏 ` : "";
}

export function renderLocalizedGreeting(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  isRegistered: boolean;
  firstName?: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const fName = opts.firstName ? localizePersonOrClinicName(opts.firstName, opts.lang) : "";

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    const intro =
      opts.isRegistered && fName
        ? `नमस्ते ${fName}! 🙏 *${clinic}* में आपका स्वागत है।\n\nआज मैं आपकी क्या सहायता कर सकती हूँ? मैं आपकी २४/७ एआई क्लिनिक रिसेप्शनिस्ट (माया) हूँ:`
        : `नमस्ते! 🙏 *${clinic}* से संपर्क करने के लिए धन्यवाद, आज मैं आपकी क्या सहायता कर सकती हूँ?\n\nमैं आपकी २४/७ एआई क्लिनिक रिसेप्शनिस्ट (माया) हूँ:`;

    return {
      content:
        `${intro}\n\n` +
        `• 📅 *डॉक्टर अपॉइंटमेंट* — उपलब्ध स्लॉट देखें व तुरंत टोकन बुक करें\n` +
        `• ⏰ *डॉक्टर समय सारणी और ओपीडी समय* — विशेषज्ञ डॉक्टरों की उपलब्धता\n` +
        `• 💊 *पर्ची और दवाइयाँ* — डिजिटल हस्ताक्षरित पर्ची देखें व डाउनलोड करें\n` +
        `• 🔔 *फॉलो-अप स्थिति* — अगली परामर्श तिथि जानें\n` +
        `• 🔬 *जांच रिपोर्ट* — पैथोलॉजी और लैब रिपोर्ट देखें\n` +
        `• 📍 *क्लिनिक का पता और समय* — पता, मार्ग व हेल्पलाइन\n\n` +
        `कृपया अपनी आवश्यकता लिखकर भेजें या नीचे दिए गए विकल्प चुनें:`,
      buttons: opts.isRegistered
        ? [b.bookAppointment, b.doctorSchedule, b.myPrescription, b.followUpStatus]
        : [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  const intro =
    opts.isRegistered && fName
      ? `नमस्कार ${fName}! 🙏 *${clinic}* मध्ये आपले स्वागत आहे.\n\nआज मी तुम्हाला कशी मदत करू शकते? मी तुमची २४/७ एआय क्लिनिक रिसेप्शनिस्ट (माया) आहे:`
      : `नमस्कार! 🙏 *${clinic}* शी संपर्क साधल्याबद्दल धन्यवाद, आज मी तुम्हाला कशी मदत करू शकते?\n\nमी तुमची २४/७ एआय क्लिनिक रिसेप्शनिस्ट (माया) आहे:`;

  return {
    content:
      `${intro}\n\n` +
      `• 📅 *डॉक्टर अपॉइंटमेंट* — उपलब्ध वेळ तपासा व लगेच टोकन बुक करा\n` +
      `• ⏰ *डॉक्टर वेळापत्रक आणि ओपीडी वेळ* — तज्ज्ञ डॉक्टरांची उपलब्धता\n` +
      `• 💊 *औषधपत्र आणि औषधे* — डिजिटल स्वाक्षरी केलेले औषधपत्र पहा व डाउनलोड करा\n` +
      `• 🔔 *फॉलो-अप स्थिती* — पुढील तपासणीची तारीख तपासा\n` +
      `• 🔬 *तपासणी अहवाल* — लॅब आणि पॅथॉलॉजी अहवाल पहा\n` +
      `• 📍 *क्लिनिकचा पत्ता आणि वेळ* — पत्ता, दिशा व हेल्पलाइन\n\n` +
      `कृपया तुम्हाला कोणती मदत हवी आहे ते लिहा किंवा खालील पर्याय निवडा:`,
    buttons: opts.isRegistered
      ? [b.bookAppointment, b.doctorSchedule, b.myPrescription, b.followUpStatus]
      : [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
  };
}

export function renderLocalizedLocation(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  rawClinicNameForMap: string;
  customAddress?: string;
  customPhone?: string;
  isRegistered: boolean;
  firstName?: string;
  pendingDoctor?: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const header = localizedGreetingHeader(opts.lang, opts.isRegistered, opts.firstName);
  const pDoc = opts.pendingDoctor ? localizePersonOrClinicName(opts.pendingDoctor, opts.lang) : "";
  const phone = opts.customPhone || "+91 99999 73271";
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(opts.rawClinicNameForMap)}`;

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    const addr =
      opts.customAddress && !/health hub/i.test(opts.customAddress)
        ? localizePersonOrClinicName(opts.customAddress, "hi")
        : "104-106, हेल्थ हब, सेक्टर 14, मेट्रो स्टेशन के सामने, गुरुग्राम, हरियाणा 122001";
    const docNote = pDoc
      ? `\n\n📌 *${pDoc} से परामर्श हेतु*:\nओपीडी कक्ष 105 में उपलब्ध हैं। क्या मैं अभी आपका स्लॉट बुक कर दूँ?`
      : "\n\nक्या आप क्लिनिक आने से पहले डॉक्टर से अपॉइंटमेंट बुक करना चाहेंगे?";
    return {
      content:
        `${header}📍 *${clinic} — पता और दिशा-निर्देश*\n\n` +
        `🏥 *पता*: ${addr}\n` +
        `📌 *पहचान चिह्न*: सेंट्रल बैंक के पास, मेट्रो पिलर नं. 42\n` +
        `🚗 *पार्किंग*: रोगियों के लिए समर्पित पार्किंग सुविधा उपलब्ध\n` +
        `🗺️ *गूगल मैप्स*: ${mapsUrl}\n\n` +
        `🕒 *ओपीडी कार्य समय*: सोमवार – शनिवार: सुबह 09:00 – रात 08:00 | रविवार: सुबह 10:00 – दोपहर 02:00\n` +
        `📞 *रिसेप्शन / हेल्पलाइन*: ${phone}${docNote}`,
      buttons: opts.pendingDoctor
        ? [compactDoctorBookButton(opts.pendingDoctor, "hi"), b.otherSlots, b.callHelpline]
        : [b.bookAppointment, b.doctorSchedule, b.callHelpline],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  const addr =
    opts.customAddress && !/health hub/i.test(opts.customAddress)
      ? localizePersonOrClinicName(opts.customAddress, "mr")
      : "104-106, हेल्थ हब, सेक्टर 14, मेट्रो स्टेशन समोर, गुरुग्राम, हरियाणा 122001";
  const docNote = pDoc
    ? `\n\n📌 *${pDoc} यांच्या भेटीसाठी*:\nत्यांचे ओपीडी दालन क्र. 105 मध्ये आहे. मी तुमची वेळ आत्ताच निश्चित करू का?`
    : "\n\nक्लिनिकला भेट देण्यापूर्वी तुम्हाला डॉक्टरांची अपॉइंटमेंट बुक करायची आहे का?";
  return {
    content:
      `${header}📍 *${clinic} — पत्ता आणि दिशा*\n\n` +
      `🏥 *पत्ता*: ${addr}\n` +
      `📌 *खूण*: सेंट्रल बँकेशेजारी, मेट्रो पिलर क्र. 42\n` +
      `🚗 *पार्किंग*: रुग्णांसाठी स्वतंत्र पार्किंग सुविधा उपलब्ध\n` +
      `🗺️ *गूगल मॅप्स*: ${mapsUrl}\n\n` +
      `🕒 *ओपीडी वेळ*: सोमवार – शनिवार: सकाळी 09:00 – रात्री 08:00 | रविवार: सकाळी 10:00 – दुपारी 02:00\n` +
      `📞 *रिसेप्शन / हेल्पलाइन*: ${phone}${docNote}`,
    buttons: opts.pendingDoctor
      ? [compactDoctorBookButton(opts.pendingDoctor, "mr"), b.otherSlots, b.callHelpline]
      : [b.bookAppointment, b.doctorSchedule, b.callHelpline],
  };
}

export function renderLocalizedClinicTimings(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  isRegistered: boolean;
  firstName?: string;
  pendingDoctor?: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const header = localizedGreetingHeader(opts.lang, opts.isRegistered, opts.firstName);
  const pDoc = opts.pendingDoctor ? localizePersonOrClinicName(opts.pendingDoctor, opts.lang) : "";

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    const note = pDoc
      ? `\n\n👨‍⚕️ *${pDoc} का आज का ओपीडी समय*:\nसुबह 08:30 – दोपहर 01:30 और शाम 04:30 – रात 08:00। टोकन बुक करने के लिए नीचे चुनें:`
      : "\n\nक्या आप किसी विशेषज्ञ डॉक्टर की समय सारणी देखना या अपॉइंटमेंट बुक करना चाहेंगे?";
    return {
      content:
        `${header}⏰ *${clinic} — क्लिनिक एवं ओपीडी कार्य समय*\n\n` +
        `🗓️ *ओपीडी परामर्श समय*:\n` +
        `• *सोमवार से शनिवार*: सुबह 09:00 – रात 08:00\n` +
        `• *रविवार*: सुबह 10:00 – दोपहर 02:00 (आपातकालीन एवं पूर्व-निर्धारित परामर्श)\n\n` +
        `🔬 *पैथोलॉजी जांच लैब*:\n` +
        `• सैंपल संग्रह प्रतिदिन सुबह 08:00 बजे से प्रारंभ\n\n` +
        `💊 *इन-हाउस फार्मेसी (मेडिकल स्टोर)*:\n` +
        `• प्रतिदिन सुबह 08:30 – रात 08:30 तक खुला${note}`,
      buttons: opts.pendingDoctor
        ? [compactDoctorBookButton(opts.pendingDoctor, "hi"), b.doctorSchedule, b.clinicLocation]
        : [b.doctorSchedule, b.bookAppointment, b.clinicLocation],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  const note = pDoc
    ? `\n\n👨‍⚕️ *${pDoc} यांची आजची ओपीडी वेळ*:\nसकाळी 08:30 – दुपारी 01:30 आणि संध्याकाळी 04:30 – रात्री 08:00. टोकन बुक करण्यासाठी खालील पर्याय निवडा:`
    : "\n\nतुम्हाला विशिष्ट डॉक्टरांचे वेळापत्रक पाहायचे आहे की अपॉइंटमेंट बुक करायची आहे?";
  return {
    content:
      `${header}⏰ *${clinic} — क्लिनिक आणि ओपीडी वेळ*\n\n` +
      `🗓️ *ओपीडी तपासणी वेळ*:\n` +
      `• *सोमवार ते शनिवार*: सकाळी 09:00 – रात्री 08:00\n` +
      `• *रविवार*: सकाळी 10:00 – दुपारी 02:00 (तातडीची सेवा व पूर्वनियोजित तपासणी)\n\n` +
      `🔬 *पॅथॉलॉजी लॅब*:\n` +
      `• रक्ताचे नमुने घेणे दररोज सकाळी 08:00 पासून सुरू\n\n` +
      `💊 *क्लिनिक मेडिकल स्टोअर*:\n` +
      `• दररोज सकाळी 08:30 – रात्री 08:30 पर्यंत सुरू${note}`,
    buttons: opts.pendingDoctor
      ? [compactDoctorBookButton(opts.pendingDoctor, "mr"), b.doctorSchedule, b.clinicLocation]
      : [b.doctorSchedule, b.bookAppointment, b.clinicLocation],
  };
}

export function renderLocalizedContact(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  isRegistered: boolean;
  firstName?: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const header = localizedGreetingHeader(opts.lang, opts.isRegistered, opts.firstName);

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `${header}📞 *${clinic} — संपर्क एवं रिसेप्शन डेस्क*\n\n` +
        `☎️ *रिसेप्शन एवं अपॉइंटमेंट*: +91 99999 73271\n` +
        `💬 *व्हाट्सएप सहायक*: २४/७ स्वचालित बुकिंग और मेडिकल रिकॉर्ड\n` +
        `📍 *पता*: 104-106, हेल्थ हब, सेक्टर 14, गुरुग्राम\n\n` +
        `🕒 *रिसेप्शन स्टाफ उपलब्धता*: सुबह 09:00 – रात 08:00 (सोमवार–शनिवार)\n\n` +
        `हमारी टीम आज आपकी किस प्रकार सहायता कर सकती है?`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `${header}📞 *${clinic} — संपर्क आणि रिसेप्शन डेस्क*\n\n` +
      `☎️ *रिसेप्शन व अपॉइंटमेंट*: +91 99999 73271\n` +
      `💬 *व्हॉट्सअॅप सहाय्यक*: २४/७ स्वयंचलित बुकिंग व वैद्यकीय नोंदी\n` +
      `📍 *पत्ता*: 104-106, हेल्थ हब, सेक्टर 14, गुरुग्राम\n\n` +
      `🕒 *रिसेप्शन कर्मचारी वेळ*: सकाळी 09:00 – रात्री 08:00 (सोमवार–शनिवार)\n\n` +
      `आमची टीम तुम्हाला कशी मदत करू शकते?`,
    buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
  };
}

export function renderLocalizedFees(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  isRegistered: boolean;
  firstName?: string;
  pendingDoctor?: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const header = localizedGreetingHeader(opts.lang, opts.isRegistered, opts.firstName);
  const pDoc = opts.pendingDoctor ? localizePersonOrClinicName(opts.pendingDoctor, opts.lang) : "";

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    const note = pDoc
      ? `\n\n👨‍⚕️ *${pDoc} परामर्श शुल्क*: ₹700 (ओपीडी जांच एवं फॉलो-अप वैधता सहित)। क्या आप बुकिंग पक्की करना चाहेंगे?`
      : "\n\nक्या आप किसी विशेषज्ञ डॉक्टर का सटीक शुल्क जानना या अपॉइंटमेंट बुक करना चाहेंगे?";
    return {
      content:
        `${header}💵 *${clinic} — परामर्श शुल्क विवरण*\n\n` +
        `• *सामान्य चिकित्सा (ओपीडी)*: ₹500\n` +
        `• *विशेषज्ञ परामर्श* (फिजियोथेरेपी, बाल रोग, त्वचा रोग, हृदय रोग): ₹700 – ₹1,000\n` +
        `• *फॉलो-अप परामर्श*: प्रथम परामर्श के 7 दिनों के भीतर निःशुल्क या रियायती\n\n` +
        `💳 *स्वीकृत भुगतान माध्यम*:\n` +
        `• यूपीआई (गूगल पे, फोनपे, पेटीएम, भीम)\n` +
        `• क्रेडिट एवं डेबिट कार्ड (वीज़ा, मास्टरकार्ड, रूपे)\n` +
        `• रिसेप्शन डेस्क पर नकद भुगतान\n` +
        `• कैशलेस स्वास्थ्य बीमा (चयनित टीपीए)${note}`,
      buttons: opts.pendingDoctor
        ? [compactDoctorBookButton(opts.pendingDoctor, "hi"), b.otherDoctors, b.speakReception]
        : [b.doctorSchedule, b.bookAppointment, b.speakReception],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  const note = pDoc
    ? `\n\n👨‍⚕️ *${pDoc} तपासणी फी*: ₹700 (ओपीडी तपासणी व फॉलो-अप वैधतेसह). मी तुमची बुकिंग निश्चित करू का?`
    : "\n\nतुम्हाला विशिष्ट तज्ज्ञ डॉक्टरांची फी तपासायची आहे की अपॉइंटमेंट बुक करायची आहे?";
  return {
    content:
      `${header}💵 *${clinic} — तपासणी फी आणि शुल्क तक्ता*\n\n` +
      `• *सामान्य वैद्यकशास्त्र (ओपीडी)*: ₹500\n` +
      `• *तज्ज्ञ डॉक्टर सल्ला* (फिजिओथेरपी, बालरोग, त्वचारोग, हृदयरोग): ₹700 – ₹1,000\n` +
      `• *फॉलो-अप तपासणी*: पहिल्या तपासणीनंतर 7 दिवसांच्या आत मोफत किंवा सवलतीत\n\n` +
      `💳 *पेमेंट पर्याय*:\n` +
      `• यूपीआय (गूगल पे, फोनपे, पेटीएम, भीम)\n` +
      `• क्रेडिट व डेबिट कार्ड (व्हिसा, मास्टरकार्ड, रूपे)\n` +
      `• रिसेप्शनवर रोख रक्कम\n` +
      `• कॅशलेस आरोग्य विमा (निवडक टीपीए)${note}`,
    buttons: opts.pendingDoctor
      ? [compactDoctorBookButton(opts.pendingDoctor, "mr"), b.otherDoctors, b.speakReception]
      : [b.doctorSchedule, b.bookAppointment, b.speakReception],
  };
}

export function renderLocalizedInsurance(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  isRegistered: boolean;
  firstName?: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const header = localizedGreetingHeader(opts.lang, opts.isRegistered, opts.firstName);

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `${header}🛡️ *${clinic} — स्वास्थ्य बीमा एवं कैशलेस सहायता डेस्क*\n\n` +
        `• *कैशलेस टीपीए सहायता*: हम स्टार हेल्थ, एचडीएफसी एर्गो, आईसीआईसीआई लोम्बार्ड, केयर हेल्थ, निवा बूपा, मेडी असिस्ट और पैरामाउंट सहित प्रमुख स्वास्थ्य बीमा कंपनियों के साथ समन्वय करते हैं।\n` +
        `• *ओपीडी प्रतिपूर्ति (रीइम्बर्समेंट)*: क्लेम प्रक्रिया को सरल बनाने के लिए हम जीएसटी बिल, डॉक्टर परामर्श रसीद और हस्ताक्षरित मेडिकल नोट्स प्रदान करते हैं।\n` +
        `• *बीमा सहायता समय*: सोमवार से शनिवार, सुबह 09:00 – शाम 06:00 बजे तक।\n\n` +
        `क्या आप परामर्श बुक करना या हमारे बीमा डेस्क से बात करना चाहेंगे?`,
      buttons: [b.bookAppointment, b.speakReception, b.callHelpline],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `${header}🛡️ *${clinic} — आरोग्य विमा आणि कॅशलेस कक्ष*\n\n` +
      `• *कॅशलेस टीपीए सुविधा*: आम्ही स्टार हेल्थ, एचडीएफसी एर्गो, आयसीआयसीआय लोम्बार्ड, केअर हेल्थ, निवा बुपा, मेडी असिस्ट आणि पॅरामाउंट यांसारख्या प्रमुख विमा कंपन्यांशी समन्वय साधतो.\n` +
      `• *ओपीडी परतावा (रीइम्बर्समेंट)*: विमा दाव्यासाठी आम्ही सविस्तर जीएसटी पावती, डॉक्टर सल्ला पावती आणि स्वाक्षरी केलेल्या वैद्यकीय नोंदी देतो.\n` +
      `• *विमा मदत कक्ष वेळ*: सोमवार ते शनिवार, सकाळी 09:00 – संध्याकाळी 06:00.\n\n` +
      `तुम्हाला अपॉइंटमेंट बुक करायची आहे की आमच्या विमा कक्षाशी बोलायचे आहे?`,
    buttons: [b.bookAppointment, b.speakReception, b.callHelpline],
  };
}

export function renderLocalizedSpecialties(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  isRegistered: boolean;
  firstName?: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const header = localizedGreetingHeader(opts.lang, opts.isRegistered, opts.firstName);

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `${header}🩺 *${clinic} — चिकित्सा विभाग एवं सेवाएँ*\n\n` +
        `हमारे क्लिनिक में प्रमुख विभागों में विशेषज्ञ ओपीडी एवं जांच सेवाएँ उपलब्ध हैं:\n\n` +
        `• 🩺 *सामान्य एवं आंतरिक चिकित्सा* — बुखार, संक्रमण, मधुमेह (शुगर), रक्तचाप (बीपी)\n` +
        `• 🏃 *फिजियोथेरेपी एवं पुनर्वास* — जोड़ों का दर्द, कमर व रीढ़ का उपचार\n` +
        `• 👶 *बाल रोग एवं शिशु स्वास्थ्य* — टीकाकरण, नवजात देखभाल, विकास जांच\n` +
        `• 🧴 *त्वचा एवं कॉस्मेटोलॉजी* — त्वचा एलर्जी, मुँहासे, एक्जिमा, बालों का उपचार\n` +
        `• ❤️ *हृदय रोग विभाग* — ईसीजी, बीपी जांच, हृदय परामर्श\n` +
        `• 🔬 *पैथोलॉजी एवं डायग्नोस्टिक लैब* — रक्त व पैथोलॉजी जांच\n` +
        `• 💊 *इन-हाउस फार्मेसी* — प्रामाणिक निर्धारित दवाइयाँ\n\n` +
        `आप किस विभाग में परामर्श लेना चाहेंगे?`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `${header}🩺 *${clinic} — वैद्यकीय विभाग आणि सेवा*\n\n` +
      `आमच्या क्लिनिकमध्ये खालील प्रमुख विभागांमध्ये तज्ज्ञ ओपीडी आणि तपासणी सेवा उपलब्ध आहेत:\n\n` +
      `• 🩺 *सामान्य वैद्यकशास्त्र* — ताप, संसर्ग, मधुमेह (शुगर), रक्तदाब (बीपी)\n` +
      `• 🏃 *फिजिओथेरपी व पुनर्वसन* — सांधेदुखी, कंबर व मणक्याचे उपचार\n` +
      `• 👶 *बालरोग व शिशु आरोग्य* — लसीकरण, नवजात शिशु काळजी, वाढ तपासणी\n` +
      `• 🧴 *त्वचारोग व सौंदर्योपचार* — त्वचेची अॅलर्जी, मुरूम, एक्झिमा, केसांचे उपचार\n` +
      `• ❤️ *हृदयरोग विभाग* — ईसीजी, रक्तदाब तपासणी, हृदयरोग सल्ला\n` +
      `• 🔬 *पॅथॉलॉजी व डायग्नोस्टिक लॅब* — सर्व प्रकारच्या रक्त व लघवी तपासण्या\n` +
      `• 💊 *क्लिनिक मेडिकल स्टोअर* — डॉक्टरांनी लिहून दिलेली अधिकृत औषधे\n\n` +
      `तुम्हाला कोणत्या विभागाचा सल्ला घ्यायचा आहे?`,
    buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation],
  };
}

export function renderLocalizedEmergency(opts: {
  lang: "hi" | "mr";
  clinicName: string;
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `🚨 *आपातकालीन चिकित्सा सूचना*\n\n` +
        `यदि आपको या किसी मरीज को गंभीर आपातकालीन लक्षण (जैसे सीने में तेज दर्द, सांस लेने में गंभीर तकलीफ, अचानक लकवा, अत्यधिक रक्तस्राव या बेहोशी) हो रहे हैं:\n\n` +
        `🚑 *राष्ट्रीय आपातकालीन एम्बुलेंस*: तुरंत *108* या *112* पर कॉल करें।\n` +
        `🏥 *निकटतम २४/७ इमरजेंसी कक्ष*: कृपया तुरंत नजदीकी अस्पताल के आपातकालीन विभाग में जाएं।\n\n` +
        `📞 *${clinic} आपातकालीन हेल्पलाइन*: +91 99999 73271\n` +
        `तत्काल ओपीडी परामर्श के लिए नीचे दिए गए विकल्प चुनें:`,
      buttons: [b.urgentSlot, b.clinicLocation, b.callHelpline],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `🚨 *तातडीची वैद्यकीय सूचना*\n\n` +
      `जर तुम्हाला किंवा रुग्णाला गंभीर आणीबाणीची लक्षणे (जसे की छातीत तीव्र वेदना, श्वास घेण्यास प्रचंड त्रास, अचानक अर्धांगवायू, अतिरक्तस्राव किंवा बेशुद्धी) जाणवत असतील तर:\n\n` +
      `🚑 *राष्ट्रीय आपत्कालीन रुग्णवाहिका*: तात्काळ *108* किंवा *112* वर कॉल करा.\n` +
      `🏥 *जवळचे २४/७ अतिदक्षता केंद्र*: कृपया तातडीने जवळच्या रुग्णालयाच्या आपत्कालीन विभागात जा.\n\n` +
      `📞 *${clinic} तातडीची हेल्पलाइन*: +91 99999 73271\n` +
      `तातडीच्या ओपीडी तपासणीसाठी खालील पर्याय निवडा:`,
    buttons: [b.urgentSlot, b.clinicLocation, b.callHelpline],
  };
}

export function renderLocalizedDoctorMatch(opts: {
  lang: "hi" | "mr";
  doctor: Record<string, unknown>;
  isRegistered: boolean;
  firstName?: string;
}): BotReplyPayload {
  const rawDocName = String(opts.doctor.name || "");
  const docName = localizePersonOrClinicName(rawDocName, opts.lang);
  const spec = localizeSpecialtyLabel(String(opts.doctor.specialty || ""), opts.lang);
  const timing = localizeTimingLabel(String(opts.doctor.opd_timing || "09:00 AM - 01:00 PM"), opts.lang);
  const room = localizeRoomLabel(String(opts.doctor.opd_room || "101"), opts.lang);
  const fee = formatINR(Number(opts.doctor.consultation_fee || 0));
  const header = localizedGreetingHeader(opts.lang, opts.isRegistered, opts.firstName);

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `${header}👨‍⚕️ *${docName}* (${spec})\n\n` +
        `🕒 *ओपीडी समय*: ${timing} | 🚪 ${room}\n` +
        `💵 *परामर्श शुल्क*: ${fee}\n\n` +
        `क्या आप ${docName} के साथ अपॉइंटमेंट बुक करना चाहेंगे?`,
      buttons: [compactDoctorBookButton(rawDocName, "hi"), b.otherDoctors, b.allSlots],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `${header}👨‍⚕️ *${docName}* (${spec})\n\n` +
      `🕒 *ओपीडी वेळ*: ${timing} | 🚪 ${room}\n` +
      `💵 *तपासणी फी*: ${fee}\n\n` +
      `तुम्हाला ${docName} यांच्यासोबत अपॉइंटमेंट बुक करायची आहे का?`,
    buttons: [compactDoctorBookButton(rawDocName, "mr"), b.otherDoctors, b.allSlots],
  };
}

export function renderLocalizedDoctorRoster(opts: {
  lang: "hi" | "mr";
  clinicName: string;
  doctors: Record<string, unknown>[];
}): BotReplyPayload {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const feeLabel = opts.lang === "hi" ? "शुल्क" : "फी";

  const roster = opts.doctors
    .map((d) => {
      const name = localizePersonOrClinicName(String(d.name || ""), opts.lang);
      const spec = localizeSpecialtyLabel(String(d.specialty || ""), opts.lang);
      const timing = localizeTimingLabel(String(d.opd_timing || "09:00 AM - 01:00 PM"), opts.lang);
      const room = localizeRoomLabel(String(d.opd_room || "101"), opts.lang);
      const fee = formatINR(Number(d.consultation_fee || 0));
      return `👨‍⚕️ *${name}* (${spec})\n  🕒 ${timing} | 🚪 ${room}\n  💵 ${feeLabel}: ${fee}`;
    })
    .join("\n\n");

  const buttons = opts.doctors.slice(0, 3).map((d) => compactDoctorBookButton(String(d.name || ""), opts.lang));

  if (opts.lang === "hi") {
    return {
      content: `⏰ *${clinic} — ओपीडी डॉक्टर समय सारणी*:\n\n${roster}\n\nआपातकालीन चिकित्सा एवं ट्रायज सहायता २४/७ उपलब्ध है।`,
      buttons,
    };
  }
  return {
    content: `⏰ *${clinic} — ओपीडी डॉक्टर वेळापत्रक*:\n\n${roster}\n\nतातडीची वैद्यकीय सेवा आणि ट्रायज कक्ष २४/७ कार्यरत आहे.`,
    buttons,
  };
}

export function renderLocalizedBookingConfirmed(opts: {
  lang: "hi" | "mr";
  reused: boolean;
  appointment: {
    tokenNumber: number | string;
    doctorName: string;
    specialty: string;
    date: string;
    timeSlot?: string;
    uhid?: string;
    status: string;
  };
}): BotReplyPayload {
  const doc = localizePersonOrClinicName(opts.appointment.doctorName, opts.lang);
  const spec = localizeSpecialtyLabel(opts.appointment.specialty, opts.lang);
  const slot = localizeTimingLabel(opts.appointment.timeSlot || "OPD hours", opts.lang);
  const status = localizeAppointmentStatus(opts.appointment.status, opts.lang);

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    const title = opts.reused ? "📌 *आपकी पूर्व-सक्रिय बुकिंग मिली*" : "🎉 *अपॉइंटमेंट की पुष्टि हो गई!*";
    return {
      content:
        `${title}\n\n` +
        `*टोकन संख्या*: *#${opts.appointment.tokenNumber}*\n` +
        `*डॉक्टर*: ${doc}\n` +
        `*विभाग*: ${spec}\n` +
        `*तारीख*: ${opts.appointment.date}\n` +
        `*समय स्लॉट*: ${slot}\n` +
        `*रोगी पहचान क्रमांक*: ${opts.appointment.uhid || "-"}\n` +
        `*स्थिति*: ${status}\n\n` +
        `आपका अपॉइंटमेंट क्लिनिक कैलेंडर में दर्ज हो गया है। कृपया अपने निर्धारित समय से 10 मिनट पहले पधारें।`,
      buttons: [b.viewQueue, b.reschedule, b.cancelAppt],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  const title = opts.reused ? "📌 *तुमची आधीची सक्रिय बुकिंग आढळली*" : "🎉 *तुमची अपॉइंटमेंट निश्चित झाली आहे!*";
  return {
    content:
      `${title}\n\n` +
      `*टोकन क्रमांक*: *#${opts.appointment.tokenNumber}*\n` +
      `*डॉक्टर*: ${doc}\n` +
      `*विभाग*: ${spec}\n` +
      `*तारीख*: ${opts.appointment.date}\n` +
      `*वेळ*: ${slot}\n` +
      `*रुग्ण ओळख क्रमांक*: ${opts.appointment.uhid || "-"}\n` +
      `*स्थिती*: ${status}\n\n` +
      `तुमची अपॉइंटमेंट क्लिनिकच्या वेळापत्रकात नोंदवली गेली आहे. कृपया तुमच्या वेळेच्या १० मिनिटे आधी उपस्थित रहा.`,
    buttons: [b.viewQueue, b.reschedule, b.cancelAppt],
  };
}

export function renderLocalizedIntakePrompt(lang: "hi" | "mr"): BotReplyPayload {
  if (lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `📋 *परामर्श-पूर्व संक्षिप्त जानकारी*\n\n` +
        `आपके लिए उपयुक्त विशेषज्ञ डॉक्टर और सही समय स्लॉट चुनने के लिए कृपया यह विवरण साझा करें:\n\n` +
        `1️⃣ *रोगी का नाम*\n` +
        `2️⃣ *आयु (उम्र)*\n` +
        `3️⃣ *स्वास्थ्य समस्या या लक्षण*\n\n` +
        `_(आप एक ही संदेश में जानकारी भेज सकते हैं, या सीधे उपलब्ध स्लॉट देखने के लिए नीचे **स्लॉट्स देखें** पर टैप करें।)_`,
      buttons: [
        b.skipViewSlots,
        compactDoctorBookButton("Dr. Siddharth", "hi"),
        compactDoctorBookButton("Dr. Vikram", "hi"),
      ],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `📋 *तपासणीपूर्वी प्राथमिक माहिती*\n\n` +
      `तुमच्यासाठी योग्य तज्ज्ञ डॉक्टर आणि वेळ निवडण्यासाठी कृपया खालील माहिती पाठवा:\n\n` +
      `1️⃣ *रुग्णाचे नाव*\n` +
      `2️⃣ *वय*\n` +
      `3️⃣ *त्रास किंवा लक्षणे*\n\n` +
      `_(तुम्ही एकाच मेसेजमध्ये ही माहिती पाठवू शकता किंवा थेट सर्व उपलब्ध वेळ पाहण्यासाठी खालील **स्लॉट्स पहा** वर टॅप करा.)_`,
    buttons: [
      b.skipViewSlots,
      compactDoctorBookButton("Dr. Siddharth", "mr"),
      compactDoctorBookButton("Dr. Vikram", "mr"),
    ],
  };
}

export function renderLocalizedIntakeSlots(opts: {
  lang: "hi" | "mr";
  patientName: string;
  recommendedDoc?: string;
  recommendedSpec?: string;
  doctors: Record<string, unknown>[];
}): BotReplyPayload {
  const cleanName =
    opts.patientName && opts.patientName !== "Patient" && !opts.patientName.startsWith("Patient (")
      ? `*${localizePersonOrClinicName(opts.patientName, opts.lang)}*`
      : "";
  const feeLabel = opts.lang === "hi" ? "शुल्क" : "फी";

  const slotItems = opts.doctors
    .slice(0, 4)
    .map((d) => {
      const name = localizePersonOrClinicName(String(d.name || ""), opts.lang);
      const spec = localizeSpecialtyLabel(String(d.specialty || ""), opts.lang);
      const timing = localizeTimingLabel(String(d.opd_timing || "09:00 AM - 01:00 PM"), opts.lang);
      const room = localizeRoomLabel(String(d.opd_room || "101"), opts.lang);
      const fee = formatINR(Number(d.consultation_fee || 0));
      return `👨‍⚕️ *${name}* (${spec})\n  🕒 ${timing} | 🚪 ${room}\n  💵 ${feeLabel}: ${fee}`;
    })
    .join("\n\n");

  const buttons = opts.doctors.slice(0, 3).map((d) => compactDoctorBookButton(String(d.name || ""), opts.lang));
  const topDocName = localizePersonOrClinicName(
    String(opts.doctors[0]?.name || opts.recommendedDoc || ""),
    opts.lang
  );
  const topDocSpec = localizeSpecialtyLabel(
    String(opts.doctors[0]?.specialty || opts.recommendedSpec || ""),
    opts.lang
  );

  if (opts.lang === "hi") {
    const recLine = opts.recommendedDoc
      ? `💡 *अनुशंसित विशेषज्ञ*: आपके लक्षणों के आधार पर *${topDocName}* (${topDocSpec}) परामर्श के लिए उपलब्ध हैं।\n\n`
      : "";
    return {
      content:
        `धन्यवाद${cleanName ? ` ${cleanName}` : ""}! 🙏 हमने आपका विवरण नोट कर लिया है।\n\n` +
        `${recLine}📅 *आज के उपलब्ध ओपीडी परामर्श स्लॉट*:\n\n${slotItems}\n\n` +
        `अपना अपॉइंटमेंट पक्का करने के लिए कृपया नीचे दिए गए विकल्प चुनें:`,
      buttons,
    };
  }

  const recLine = opts.recommendedDoc
    ? `💡 *शिफारस केलेले तज्ज्ञ*: तुमच्या लक्षणांनुसार *${topDocName}* (${topDocSpec}) सल्ल्यासाठी उपलब्ध आहेत.\n\n`
    : "";
  return {
    content:
      `धन्यवाद${cleanName ? ` ${cleanName}` : ""}! 🙏 आम्ही तुमची माहिती नोंदवली आहे.\n\n` +
      `${recLine}📅 *आजचे उपलब्ध ओपीडी स्लॉट्स*:\n\n${slotItems}\n\n` +
      `तुमची अपॉइंटमेंट निश्चित करण्यासाठी खालील पर्याय निवडा:`,
    buttons,
  };
}

export function renderLocalizedFollowUp(opts: {
  lang: "hi" | "mr";
  patientName: string;
  phone: string;
  rxWithFollowUp?: Record<string, unknown>;
  lastAppt?: Record<string, unknown>;
}): BotReplyPayload {
  const pat = localizePersonOrClinicName(opts.patientName, opts.lang);
  if (opts.rxWithFollowUp && opts.rxWithFollowUp.follow_up_date) {
    const doc = localizePersonOrClinicName(String(opts.rxWithFollowUp.doctor_name || ""), opts.lang);
    const followDate = String(opts.rxWithFollowUp.follow_up_date);
    if (opts.lang === "hi") {
      const b = LOCALIZED_BUTTONS.hi;
      return {
        content:
          `📅 *फॉलो-अप परामर्श विवरण*\n\n` +
          `*रोगी*: ${pat}\n` +
          `*परामर्शदाता*: ${doc}\n` +
          `*अगली अनुशंसित जांच तिथि*: *${followDate}*\n\n` +
          `🔔 *स्वचालित रिमाइंडर*: इस तिथि से २४ घंटे पहले आपके व्हाट्सएप पर सूचना भेजी जाएगी।\n\n` +
          `क्या आप अभी अपना फॉलो-अप स्लॉट बुक करना चाहेंगे?`,
        buttons: [b.bookFollowUp, b.doctorSchedule, b.speakReception],
      };
    }
    const b = LOCALIZED_BUTTONS.mr;
    return {
      content:
        `📅 *फॉलो-अप तपासणी वेळापत्रक*\n\n` +
        `*रुग्ण*: ${pat}\n` +
        `*डॉक्टर*: ${doc}\n` +
        `*पुढील शिफारस केलेली तारीख*: *${followDate}*\n\n` +
        `🔔 *स्वयंचलित आठवण*: या तारखेच्या २४ तास आधी तुम्हाला व्हॉट्सअॅपवर आठवण पाठवली जाईल.\n\n` +
        `तुम्हाला तुमचा फॉलो-अप स्लॉट आत्ताच बुक करायचा आहे का?`,
      buttons: [b.bookFollowUp, b.doctorSchedule, b.speakReception],
    };
  }

  if (opts.lastAppt) {
    const rawDoc = String(opts.lastAppt.doctor_name || "");
    const doc = localizePersonOrClinicName(rawDoc, opts.lang);
    const spec = localizeSpecialtyLabel(String(opts.lastAppt.specialty || ""), opts.lang);
    if (opts.lang === "hi") {
      const b = LOCALIZED_BUTTONS.hi;
      return {
        content:
          `🔔 *फॉलो-अप समीक्षा*\n\n` +
          `आपकी पिछली क्लिनिक विज़िट *${opts.lastAppt.date}* को *${doc}* (${spec}) के साथ थी।\n\n` +
          `सामान्यतः प्रारंभिक परामर्श के 5–7 दिनों बाद फॉलो-अप जांच की सलाह दी जाती है। क्या आप ${doc} के साथ अपॉइंटमेंट बुक करना चाहेंगे?`,
        buttons: [compactDoctorBookButton(rawDoc, "hi"), b.otherSlots, b.speakReception],
      };
    }
    const b = LOCALIZED_BUTTONS.mr;
    return {
      content:
        `🔔 *फॉलो-अप आढावा*\n\n` +
        `तुमची मागील भेट *${opts.lastAppt.date}* रोजी *${doc}* (${spec}) यांच्याकडे झाली होती.\n\n` +
        `साधारणपणे पहिल्या तपासणीनंतर ५ ते ७ दिवसांनी फॉलो-अप तपासणीचा सल्ला दिला जातो. तुम्हाला ${doc} यांच्यासोबत अपॉइंटमेंट बुक करायची आहे का?`,
      buttons: [compactDoctorBookButton(rawDoc, "mr"), b.otherSlots, b.speakReception],
    };
  }

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `🔔 *फॉलो-अप जानकारी*\n\n` +
        `आपके पंजीकृत नंबर (${opts.phone}) के लिए कोई लंबित फॉलो-अप तिथि नहीं मिली।\n\n` +
        `यदि आपको परामर्श की आवश्यकता है, तो हमारे डॉक्टर आज ओपीडी बुकिंग के लिए उपलब्ध हैं:`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.speakReception],
    };
  }
  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `🔔 *फॉलो-अप माहिती*\n\n` +
      `तुमच्या नोंदणीकृत क्रमांकासाठी (${opts.phone}) कोणतीही प्रलंबित फॉलो-अप तारीख आढळली नाही.\n\n` +
      `तुम्हाला काही त्रास असल्यास किंवा सल्ल्याची गरज असल्यास आजच्या ओपीडीसाठी आमचे डॉक्टर उपलब्ध आहेत:`,
    buttons: [b.bookAppointment, b.doctorSchedule, b.speakReception],
  };
}

export function renderLocalizedPrescription(opts: {
  lang: "hi" | "mr";
  phone: string;
  rx?: Record<string, unknown>;
}): BotReplyPayload {
  if (opts.rx) {
    const rx = opts.rx;
    const pat = localizePersonOrClinicName(String(rx.patient_name || ""), opts.lang);
    const doc = localizePersonOrClinicName(String(rx.doctor_name || ""), opts.lang);
    const spec = localizeSpecialtyLabel(String(rx.doctor_specialty || ""), opts.lang);
    const meds = JSON.parse((rx.medicines as string) || "[]");
    const medList = meds
      .slice(0, 4)
      .map((m: any) => `• *${m.drugName}* (${m.dosage}) — ${m.frequency} [${localizeMedTiming(String(m.timing || ""), opts.lang)}]`)
      .join("\n");

    const media = {
      type: "pdf",
      title: `Prescription_${rx.rx_number}.pdf`,
      url: `/api/emr/prescription/${rx.id}/pdf`,
      size: "210 KB",
      previewData: rx,
    };

    if (opts.lang === "hi") {
      const b = LOCALIZED_BUTTONS.hi;
      const followText = rx.follow_up_date ? `\n*अगला फॉलो-अप*: *${rx.follow_up_date}*` : "";
      return {
        content:
          `💊 *डिजिटल पर्ची रिकॉर्ड मिला (${rx.rx_number})*\n\n` +
          `*रोगी*: ${pat}\n` +
          `*डॉक्टर*: ${doc} (${spec})\n` +
          `*तारीख*: ${rx.date}${followText}\n\n` +
          `*निर्धारित दवाइयाँ*:\n${medList || "• पूर्ण विवरण संलग्न पीडीएफ में देखें"}\n\n` +
          `डिजिटल हस्ताक्षरित पर्ची पीडीएफ देखने या डाउनलोड करने के लिए नीचे चुनें:`,
        buttons: [b.previewRx, b.downloadPdf, b.refillRx],
        media,
      };
    }

    const b = LOCALIZED_BUTTONS.mr;
    const followText = rx.follow_up_date ? `\n*पुढील फॉलो-अप*: *${rx.follow_up_date}*` : "";
    return {
      content:
        `💊 *डिजिटल औषधपत्र सापडले (${rx.rx_number})*\n\n` +
        `*रुग्ण*: ${pat}\n` +
        `*डॉक्टर*: ${doc} (${spec})\n` +
        `*तारीख*: ${rx.date}${followText}\n\n` +
        `*लिहून दिलेली औषधे*:\n${medList || "• संपूर्ण तपशीलासाठी जोडलेली पीडीएफ पहा"}\n\n` +
        `डिजिटल स्वाक्षरी केलेले औषधपत्र पीडीएफ पाहण्यासाठी किंवा डाउनलोड करण्यासाठी खालील पर्याय निवडा:`,
      buttons: [b.previewRx, b.downloadPdf, b.refillRx],
      media,
    };
  }

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `💊 *पर्ची रिकॉर्ड*\n\n` +
        `आपके पंजीकृत नंबर (${opts.phone}) के लिए कोई सक्रिय डिजिटल पर्ची नहीं मिली।\n\n` +
        `यदि आपने हाल ही में परामर्श लिया है, तो डॉक्टर पर्ची तैयार कर रहे होंगे, या आप हमारे रिसेप्शन से संपर्क कर सकते हैं:`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.speakReception],
    };
  }
  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `💊 *औषधपत्र नोंदी*\n\n` +
      `तुमच्या नोंदणीकृत क्रमांकासाठी (${opts.phone}) कोणतेही सक्रिय डिजिटल औषधपत्र आढळले नाही.\n\n` +
      `तुम्ही नुकताच सल्ला घेतला असल्यास डॉक्टर औषधपत्र पूर्ण करत असतील किंवा तुम्ही रिसेप्शनशी संपर्क साधू शकता:`,
    buttons: [b.bookAppointment, b.doctorSchedule, b.speakReception],
  };
}

export function renderLocalizedLabReport(opts: {
  lang: "hi" | "mr";
  patientName: string;
  phone: string;
  lab?: Record<string, unknown>;
  labPdfUrl?: string;
}): BotReplyPayload {
  const pat = localizePersonOrClinicName(opts.patientName, opts.lang);
  if (opts.lab) {
    const lab = opts.lab;
    const results = JSON.parse((lab.results as string) || "[]");
    const statusWord = (st: string) => {
      const s = String(st || "").toLowerCase();
      if (opts.lang === "hi") return s === "high" ? "अधिक" : s === "low" ? "कम" : "असामान्य";
      return s === "high" ? "जास्त" : s === "low" ? "कमी" : "असामान्य";
    };
    const flagged = results
      .filter((r: any) => r.status !== "Normal")
      .map((r: any) => `• *${r.param}*: ${r.value} ${r.unit} (${statusWord(r.status)})`)
      .join("\n");

    const media = {
      type: "pdf",
      title: `Lab_Report_${lab.id}.pdf`,
      url: opts.labPdfUrl || "",
      size: "185 KB",
      previewData: lab,
    };

    if (opts.lang === "hi") {
      const b = LOCALIZED_BUTTONS.hi;
      return {
        content:
          `🔬 *सत्यापित पैथोलॉजी जांच रिपोर्ट*\n\n` +
          `*तारीख*: ${lab.date}\n\n` +
          `*ध्यान देने योग्य परिणाम*:\n` +
          `${flagged || "सभी जांचे गए मान सामान्य सीमा के भीतर हैं।"}\n\n` +
          `पूरी रिपोर्ट पीडीएफ देखने या डॉक्टर से परामर्श करने के लिए नीचे चुनें:`,
        buttons: [b.previewLab, b.downloadPdf, b.consultDoctor],
        media,
      };
    }

    const b = LOCALIZED_BUTTONS.mr;
    return {
      content:
        `🔬 *प्रमाणित लॅब तपासणी अहवाल*\n\n` +
        `*तारीख*: ${lab.date}\n\n` +
        `*लक्ष देण्याजोगे घटक*:\n` +
        `${flagged || "सर्व तपासलेले घटक सामान्य मर्यादेत आहेत."}\n\n` +
        `संपूर्ण अहवाल पीडीएफ पाहण्यासाठी किंवा डॉक्टरांचा सल्ला घेण्यासाठी खालील पर्याय निवडा:`,
      buttons: [b.previewLab, b.downloadPdf, b.consultDoctor],
      media,
    };
  }

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `🔬 *जांच रिपोर्ट*\n\n` +
        `${pat} (${opts.phone}) के लिए कोई लंबित लैब जांच रिपोर्ट नहीं मिली।\n\n` +
        `सैंपल जांच पूरी होने पर पुनः जांचें या रिसेप्शन से संपर्क करें:`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.speakReception],
    };
  }
  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `🔬 *तपासणी अहवाल*\n\n` +
      `${pat} (${opts.phone}) यांच्यासाठी कोणताही प्रलंबित लॅब अहवाल आढळला नाही.\n\n` +
      `तपासणी पूर्ण झाल्यावर पुन्हा तपासा किंवा रिसेप्शनशी संपर्क साधा:`,
    buttons: [b.bookAppointment, b.doctorSchedule, b.speakReception],
  };
}

export function renderLocalizedQueueStatus(opts: {
  lang: "hi" | "mr";
  patientName: string;
  appointment?: {
    patientName: string;
    tokenNumber: number | string;
    doctorName: string;
    specialty: string;
    status: string;
    patientsAhead: number;
    estimatedWaitMins: number;
  };
}): BotReplyPayload {
  if (opts.appointment) {
    const a = opts.appointment;
    const pat = localizePersonOrClinicName(a.patientName, opts.lang);
    const doc = localizePersonOrClinicName(a.doctorName, opts.lang);
    const spec = localizeSpecialtyLabel(a.specialty, opts.lang);
    const status = localizeAppointmentStatus(a.status, opts.lang);

    if (opts.lang === "hi") {
      const b = LOCALIZED_BUTTONS.hi;
      return {
        content:
          `🎫 *लाइव ओपीडी टोकन एवं कतार स्थिति*\n\n` +
          `*रोगी*: ${pat}\n` +
          `*टोकन संख्या*: *#${a.tokenNumber}*\n` +
          `*डॉक्टर*: ${doc} (${spec})\n` +
          `*स्थिति*: ${status}\n\n` +
          `👥 *आपसे आगे मरीज*: *${a.patientsAhead}*\n` +
          `⏳ *अनुमानित प्रतीक्षा समय*: *~${a.estimatedWaitMins} मिनट*\n\n` +
          `कृपया प्रतीक्षा कक्ष में बने रहें। आपका नंबर आने पर हम व्हाट्सएप पर सूचित करेंगे।`,
        buttons: [b.refreshQueue, b.reschedule, b.cancelAppt],
      };
    }

    const b = LOCALIZED_BUTTONS.mr;
    return {
      content:
        `🎫 *थेट ओपीडी टोकन आणि रांगेची स्थिती*\n\n` +
        `*रुग्ण*: ${pat}\n` +
        `*टोकन क्रमांक*: *#${a.tokenNumber}*\n` +
        `*डॉक्टर*: ${doc} (${spec})\n` +
        `*स्थिती*: ${status}\n\n` +
        `👥 *तुमच्या आधीचे रुग्ण*: *${a.patientsAhead}*\n` +
        `⏳ *अंदाजे प्रतीक्षा वेळ*: *~${a.estimatedWaitMins} मिनिटे*\n\n` +
        `कृपया प्रतीक्षा कक्षात थांबा. तुमचा क्रमांक आल्यावर आम्ही तुम्हाला व्हॉट्सअॅपवर कळवू.`,
      buttons: [b.refreshQueue, b.reschedule, b.cancelAppt],
    };
  }

  const pat = localizePersonOrClinicName(opts.patientName, opts.lang);
  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `🎫 *कतार स्थिति*\n\n` +
        `आज ${pat} के लिए कोई सक्रिय प्रतीक्षा टोकन नहीं मिला।\n\n` +
        `क्या आप नया अपॉइंटमेंट बुक करना चाहेंगे?`,
      buttons: [b.bookAppointment, b.doctorSchedule],
    };
  }
  const b = LOCALIZED_BUTTONS.mr;
  return {
    content:
      `🎫 *रांगेची स्थिती*\n\n` +
      `आज ${pat} यांच्यासाठी कोणतेही सक्रिय टोकन आढळले नाही.\n\n` +
      `तुम्हाला नवीन अपॉइंटमेंट बुक करायची आहे का?`,
    buttons: [b.bookAppointment, b.doctorSchedule],
  };
}

export function renderLocalizedCancelOrReschedule(opts: {
  lang: "hi" | "mr";
  kind: "cancelled" | "cancel_not_found" | "reschedule";
  tokenNumber?: number | string;
}): BotReplyPayload {
  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    if (opts.kind === "cancelled") {
      return {
        content: `आपका अपॉइंटमेंट (टोकन #${opts.tokenNumber}) क्लिनिक कैलेंडर पर *रद्द* कर दिया गया है।`,
        buttons: [b.bookAppointment, b.speakReception],
      };
    }
    if (opts.kind === "cancel_not_found") {
      return {
        content: `रद्द करने के लिए कोई सक्रिय अपॉइंटमेंट नहीं मिला।`,
        buttons: [b.bookAppointment],
      };
    }
    return {
      content: `कृपया अपनी पसंदीदा तारीख और समय स्लॉट लिखकर भेजें, या समय बदलने के लिए रिसेप्शन से संपर्क करें।`,
      buttons: [b.bookAppointment, b.speakReception],
    };
  }

  const b = LOCALIZED_BUTTONS.mr;
  if (opts.kind === "cancelled") {
    return {
      content: `तुमची अपॉइंटमेंट (टोकन #${opts.tokenNumber}) क्लिनिकच्या वेळापत्रकातून *रद्द* करण्यात आली आहे.`,
      buttons: [b.bookAppointment, b.speakReception],
    };
  }
  if (opts.kind === "cancel_not_found") {
    return {
      content: `रद्द करण्यासाठी कोणतीही सक्रिय अपॉइंटमेंट आढळली नाही.`,
      buttons: [b.bookAppointment],
    };
  }
  return {
    content: `कृपया तुमची पसंतीची तारीख आणि वेळ कळवा किंवा वेळ बदलण्यासाठी रिसेप्शनशी संपर्क साधा.`,
    buttons: [b.bookAppointment, b.speakReception],
  };
}

export function renderLocalizedMessagingOnlyNotice(
  lang: WhatsAppLangCode,
  clinicName: string
): { textBody: string; buttons: string[] } {
  const clinic = localizePersonOrClinicName(clinicName, lang);
  if (lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      textBody:
        `नमस्ते! *${clinic}* में कॉल करने के लिए धन्यवाद।\n\n` +
        `हमारी यह लाइन अभी केवल *व्हाट्सएप संदेश सेवा* के लिए सक्रिय है। आप यहाँ २४/७ संदेश भेजकर डॉक्टर अपॉइंटमेंट बुक कर सकते हैं, ओपीडी समय देख सकते हैं, पर्ची प्राप्त कर सकते हैं या हमारे रिसेप्शन से बात कर सकते हैं।\n\n` +
        `आज मैं आपकी क्या सहायता करूँ?`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation],
    };
  }
  if (lang === "mr") {
    const b = LOCALIZED_BUTTONS.mr;
    return {
      textBody:
        `नमस्कार! *${clinic}* ला कॉल केल्याबद्दल धन्यवाद.\n\n` +
        `आमची ही लाईन सध्या केवळ *व्हॉट्सअॅप मेसेजिंगसाठी* सुरू आहे. तुम्ही येथे २४/७ मेसेज पाठवून डॉक्टर अपॉइंटमेंट बुक करू शकता, ओपीडी वेळापत्रक पाहू शकता, औषधपत्र मिळवू शकता किंवा रिसेप्शनशी बोलू शकता.\n\n` +
        `आज मी तुम्हाला कशी मदत करू?`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation],
    };
  }
  return {
    textBody:
      `Hello! Thank you for calling *${clinicName}*.\n\n` +
      `Our clinic line is currently configured for *WhatsApp messaging only*. You can text us right here 24/7 to book doctor appointments, check OPD timings, view your prescriptions, or chat with our front desk.\n\n` +
      `How may we assist you today?`,
    buttons: ["📅 Book Appointment", "⏰ Doctor Timings", "📍 Clinic Location"],
  };
}
