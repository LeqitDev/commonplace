// Synthetic mails for the triage eval (`bun scripts/triage-eval.ts --fixtures`) and the tests:
// legitimate first contacts (a new sender alone must not look like phishing), established senders,
// codes, a DHL notice, newsletters, ads, and phishing with and without hard signals. Each mail is
// built with nodemailer; `history` stands in for the mail cache.
import type { History } from '../../src/modules/mail/triage/triage.ts';

export const ME = 'me@uni.example';
export const ABOUT = "Computer science master's student and student assistant at the university";

export interface Fixture {
	id: string;
	mail: {
		from: string;
		subject: string;
		text?: string;
		html?: string;
		replyTo?: string;
		to?: string;
		headers?: Record<string, string>;
	};
	history: History;
	expect: {
		tab: 'personal' | 'orders' | 'news' | 'ads';
		phishing: boolean;
		code?: string;
		parcels?: string[];
	};
}

const pass = (d: string) => ({
	'Authentication-Results': `mx.uni.example; spf=pass smtp.mailfrom=${d}; dkim=pass header.d=${d}; dmarc=pass header.from=${d}`
});
const none: History = { sent: 0, fromAddr: 0, fromDomain: 0 };
const seen = (n: number, sent = 0): History => ({
	sent,
	fromAddr: n,
	fromDomain: n,
	since: '2026-03-02T09:00:00.000Z'
});
const list = (d: string) => ({ 'List-Unsubscribe': `<https://${d}/unsubscribe>` });

export const FIXTURES: Fixture[] = [
	// ---------------------------------------------------------------- legitimate, first contact
	{
		id: 'shop-order-new',
		mail: {
			from: 'Zalando <service@zalando.de>',
			subject: 'Danke für deine Bestellung 10293847',
			headers: pass('zalando.de'),
			html: '<p>Hallo,</p><p>vielen Dank für deine Bestellung vom 24.11.2026. Wir haben folgende Artikel erhalten:</p><table><tr><th>Artikel</th><th>Preis</th></tr><tr><td>Winterjacke, Gr. M</td><td>89,95 €</td></tr></table><p>Die Lieferung erfolgt voraussichtlich bis 28.11. <a href="https://www.zalando.de/myaccount/orders">Bestellung ansehen</a></p>'
		},
		history: none,
		expect: { tab: 'orders', phishing: false }
	},
	{
		id: 'exam-office-new',
		mail: {
			from: 'Prüfungsamt Informatik <pruefungsamt@cs.uni.example>',
			subject: 'Prüfungsanmeldung WS 26/27 – bitte bis 30.11. bestätigen',
			headers: pass('cs.uni.example'),
			text: 'Liebe Studierende,\n\nIhre Anmeldung zur Prüfung "Verteilte Systeme" am 12.02.2027 ist eingegangen. Bitte bestätigen Sie die Anmeldung bis zum 30.11.2026 im Campus-Portal: https://campus.uni.example/pruefungen\n\nNach Ablauf der Frist verfällt die Anmeldung.\n\nMit freundlichen Grüßen\nIhr Prüfungsamt'
		},
		history: none,
		expect: { tab: 'personal', phishing: false }
	},
	{
		id: 'recruiter-new',
		mail: {
			from: 'Julia Becker <j.becker@talentbridge.example>',
			subject: 'Werkstudentenstelle Backend-Entwicklung',
			headers: pass('talentbridge.example'),
			text: 'Hallo,\n\nich bin über Ihr GitHub-Profil auf Sie aufmerksam geworden. Wir suchen für ein Softwarehaus in Köln eine Werkstudentin oder einen Werkstudenten (TypeScript, 15–20 h/Woche). Hätten Sie Lust auf ein kurzes Telefonat nächste Woche?\n\nViele Grüße\nJulia Becker\nTalentbridge GmbH'
		},
		history: none,
		expect: { tab: 'personal', phishing: false }
	},
	{
		id: 'friend-freemail-new',
		mail: {
			from: 'Tom Krüger <tom.krueger90@gmail.com>',
			subject: 'Samstag Bouldern?',
			headers: pass('gmail.com'),
			text: 'Hey, hier ist Tom vom Hochschulsport! Deine Adresse hab ich von Lena. Hast du Samstag Lust auf Bouldern, so gegen 14 Uhr in der Halle am Hafen? Sag einfach Bescheid.\n\nTom'
		},
		history: none,
		expect: { tab: 'personal', phishing: false }
	},
	{
		id: 'landlord-new',
		mail: {
			from: 'Hausverwaltung Schmidt <info@hv-schmidt.example>',
			subject: 'Wasserabschaltung am Donnerstag, 3.12.',
			text: 'Sehr geehrte Mieterinnen und Mieter,\n\nwegen Arbeiten an der Hauptleitung wird am Donnerstag, 3.12., von 8 bis 12 Uhr das Wasser abgestellt. Bitte drehen Sie in dieser Zeit alle Hähne zu.\n\nMit freundlichen Grüßen\nHausverwaltung Schmidt'
		},
		history: none,
		expect: { tab: 'personal', phishing: false }
	},
	{
		id: 'ads-new',
		mail: {
			from: 'Lieferando <noreply@lieferando.de>',
			subject: '10 € Rabatt auf deine nächste Bestellung 🍕',
			headers: { ...pass('lieferando.de'), ...list('lieferando.de') },
			html: '<h1>Nur dieses Wochenende!</h1><p>Mit dem Code PIZZA10 sparst du 10 € ab 25 € Bestellwert.</p><p><a href="https://www.lieferando.de/">Jetzt bestellen</a></p>'
		},
		history: none,
		expect: { tab: 'ads', phishing: false }
	},
	// ---------------------------------------------------------------- legitimate, established
	{
		id: 'dhl-notice',
		mail: {
			from: 'DHL Paket <noreply@dhl.de>',
			subject: 'Ihr DHL Paket kommt heute',
			headers: pass('dhl.de'),
			html: '<p>Guten Tag,</p><p>Ihr Paket von Zalando wird heute zwischen 10:30 und 13:30 Uhr zugestellt.</p><p>Sendungsnummer: 00340434161234567890</p><p><a href="https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161234567890">Sendung verfolgen</a></p>'
		},
		history: seen(3),
		expect: { tab: 'orders', phishing: false, parcels: ['00340434161234567890'] }
	},
	{
		id: 'colleague',
		mail: {
			from: 'Erika Mustermann <erika@uni.example>',
			subject: 'Übungsblatt 5 – Korrektur bis Freitag?',
			headers: pass('uni.example'),
			text: 'Hallo zusammen,\n\nkönnt ihr die Korrektur von Blatt 5 bis Freitag fertig machen? Das Bewertungsschema liegt im Moodle.\n\nViele Grüße\nErika'
		},
		history: seen(14, 5),
		expect: { tab: 'personal', phishing: false }
	},
	{
		id: 'github-invite',
		mail: {
			from: 'GitHub <noreply@github.com>',
			subject: '[GitHub] @acme-lab has invited you to join the acme-lab organization',
			headers: pass('github.com'),
			text: '@mwagner has invited you to join the @acme-lab organization on GitHub.\n\nView invitation: https://github.com/orgs/acme-lab/invitation\n\nThis invitation will expire in 7 days.'
		},
		history: seen(40),
		expect: { tab: 'news', phishing: false }
	},
	{
		id: 'github-code',
		mail: {
			from: 'GitHub <noreply@github.com>',
			subject: '[GitHub] Please verify your device',
			headers: pass('github.com'),
			text: 'Hey!\n\nA sign in attempt requires further verification because we did not recognize your device. To complete the sign in, enter the verification code on the unrecognized device.\n\nDevice: Firefox on Linux\nVerification code: 482913\n\nIf you did not attempt to sign in to your account, your password may be compromised.'
		},
		history: seen(40),
		expect: { tab: 'news', phishing: false, code: '482913' }
	},
	{
		id: 'google-code-new',
		mail: {
			from: 'Google <no-reply@accounts.google.com>',
			subject: 'G-731942 ist Ihr Google-Bestätigungscode',
			headers: pass('accounts.google.com'),
			text: 'Ihr Bestätigungscode lautet\n\nG-731942\n\nGeben Sie diesen Code ein, um die Anmeldung abzuschließen. Der Code ist 10 Minuten gültig.'
		},
		history: none,
		expect: { tab: 'news', phishing: false, code: 'G-731942' }
	},
	{
		id: 'telekom-invoice',
		mail: {
			from: 'Telekom Rechnung <rechnung@telekom.de>',
			subject: 'Ihre Rechnung für November 2026',
			headers: pass('telekom.de'),
			text: 'Guten Tag,\n\nIhre Rechnung für November 2026 über 39,95 € ist online. Der Betrag wird am 2.12.2026 von Ihrem Konto abgebucht.\n\nRechnung ansehen: https://www.telekom.de/mein-kundencenter\n\nIhre Telekom'
		},
		history: seen(6),
		expect: { tab: 'orders', phishing: false }
	},
	{
		id: 'newsletter',
		mail: {
			from: 'heise online <newsletter@heise.de>',
			subject: 'heise-Newsletter: Neue Linux-Kernel-Version, KI-Regulierung',
			headers: { ...pass('heise.de'), ...list('heise.de'), 'List-Id': '<news.heise.de>' },
			html: '<h2>Die Themen heute</h2><ul><li><a href="https://www.heise.de/news/1">Linux 6.18 ist da</a></li><li><a href="https://www.heise.de/news/2">EU einigt sich auf KI-Regeln</a></li></ul>'
		},
		history: seen(25),
		expect: { tab: 'news', phishing: false }
	},
	{
		id: 'ads-known',
		mail: {
			from: 'MediaMarkt <newsletter@mediamarkt.de>',
			subject: 'Black Friday: bis zu 50 % auf Fernseher',
			headers: { ...pass('mediamarkt.de'), ...list('mediamarkt.de') },
			html: '<h1>Black Friday Deals</h1><p>Nur bis Sonntag: bis zu 50 % auf ausgewählte Fernseher und Kopfhörer.</p><a href="https://www.mediamarkt.de/de/campaign/black-friday">Zu den Angeboten</a>'
		},
		history: seen(12),
		expect: { tab: 'ads', phishing: false }
	},
	// ---------------------------------------------------------------- legitimate, but looks alarming
	{
		id: 'uni-it-password',
		mail: {
			from: 'IT-Service Universität <noreply-idm@uni.example>',
			subject: 'Ihr Passwort läuft in 7 Tagen ab',
			headers: pass('uni.example'),
			text: 'Guten Tag,\n\ndas Passwort Ihrer Uni-Kennung läuft am 02.12.2026 ab. Bitte ändern Sie es rechtzeitig im Identity-Management: https://idm.uni.example/password\n\nWir fragen Sie niemals per Mail nach Ihrem Passwort.\n\nIhr IT-Service'
		},
		history: seen(4),
		expect: { tab: 'news', phishing: false }
	},
	{
		id: 'microsoft-signin-alert',
		mail: {
			from: 'Microsoft account team <account-security-noreply@accountprotection.microsoft.com>',
			subject: 'Neue App mit Zugriff auf Ihre Daten',
			headers: pass('accountprotection.microsoft.com'),
			text: 'Thunderbird hat sich mit dem Microsoft-Konto me***@outlook.com verbunden.\n\nWenn Sie das nicht waren, überprüfen Sie Ihre Apps: https://account.live.com/consent/Manage\n\nVielen Dank,\ndas Microsoft-Kontoteam'
		},
		history: none,
		expect: { tab: 'news', phishing: false }
	},
	{
		id: 'klarna-reminder-new',
		mail: {
			from: 'Klarna <noreply@klarna.de>',
			subject: 'Zahlungserinnerung: 34,90 € an Otto bis 1. Dezember',
			headers: pass('klarna.de'),
			text: 'Hallo,\n\ndeine Zahlung über 34,90 € an Otto ist am 1. Dezember fällig. Du kannst sie in der Klarna App oder unter https://app.klarna.com begleichen.\n\nDein Klarna Team'
		},
		history: none,
		expect: { tab: 'orders', phishing: false }
	},
	{
		id: 'small-business-no-auth',
		mail: {
			from: 'Fahrradwerkstatt Lindner <werkstatt@rad-lindner.example>',
			subject: 'Ihr Rad ist fertig',
			text: 'Hallo,\n\nIhr Fahrrad ist repariert (neue Bremsbeläge, Schaltung eingestellt) und kann ab morgen abgeholt werden. Kosten: 48,50 €, bar oder mit Karte.\n\nÖffnungszeiten: Mo–Fr 10–18 Uhr.\n\nViele Grüße\nPeter Lindner'
		},
		history: none,
		expect: { tab: 'personal', phishing: false }
	},
	{
		id: 'password-reset-requested',
		mail: {
			from: 'Deutsche Bahn <noreply@bahn.de>',
			subject: 'Passwort zurücksetzen',
			headers: pass('bahn.de'),
			text: 'Hallo,\n\nSie haben das Zurücksetzen Ihres Passworts angefordert. Über den folgenden Link können Sie ein neues Passwort vergeben (24 Stunden gültig):\n\nhttps://www.bahn.de/kundenkonto/passwort?token=8f3a2c\n\nFalls Sie das nicht waren, ignorieren Sie diese E-Mail.'
		},
		history: seen(9),
		expect: { tab: 'news', phishing: false }
	},
	// ---------------------------------------------------------------- phishing
	{
		id: 'compromised-colleague',
		mail: {
			from: 'Erika Mustermann <erika@uni.example>',
			subject: 'Dokument für dich freigegeben',
			headers: pass('uni.example'),
			html: '<p>Hallo,</p><p>ich habe dir ein Dokument freigegeben: <b>Gehaltsanpassung_2027.pdf</b></p><p><a href="https://sharepoint-docs-view.click/erika">Dokument öffnen</a></p><p>Melde dich mit deinen Uni-Zugangsdaten an, um es anzusehen.</p>'
		},
		history: seen(14, 5),
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'fake-paypal-spoof',
		mail: {
			from: 'PayPal <security@account-verify.top>',
			subject: 'Ihr Konto wurde eingeschränkt',
			headers: {
				'Authentication-Results':
					'mx.uni.example; spf=softfail smtp.mailfrom=account-verify.top; dkim=none; dmarc=fail header.from=account-verify.top'
			},
			html: '<p>Sehr geehrter Kunde,</p><p>wir haben ungewöhnliche Aktivitäten festgestellt. Bestätigen Sie Ihre Identität innerhalb von 24 Stunden, sonst wird Ihr Konto dauerhaft gesperrt.</p><p><a href="https://account-verify.top/pp/login">www.paypal.com/signin</a></p>'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'fake-dhl-customs',
		mail: {
			from: 'DHL Express <info@dhl-zustellung24.xyz>',
			subject: 'Ihre Sendung wartet: Zollgebühr 1,99 € offen',
			html: '<p>Ihre Sendung konnte nicht zugestellt werden, da eine Zollgebühr von 1,99 € offen ist. Bitte bezahlen Sie innerhalb von 48 Stunden, sonst geht das Paket zurück an den Absender.</p><p><a href="https://pay-zoll-gebuehr.xyz/dhl">dhl.de/zahlung</a></p>'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'fake-sparkasse',
		mail: {
			from: 'Sparkasse <kundenservice@s-online-sicherheit.com>',
			subject: 'Wichtig: pushTAN-Verfahren muss aktualisiert werden',
			text: 'Sehr geehrte Kundin, sehr geehrter Kunde,\n\naufgrund neuer EU-Richtlinien muss Ihr pushTAN-Verfahren bis zum 30.11. aktualisiert werden. Andernfalls wird Ihr Online-Banking gesperrt.\n\nJetzt aktualisieren: https://s-online-sicherheit.com/update\n\nIhre Sparkasse'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'reply-to-freemail',
		mail: {
			from: 'Dr. James Wilson <j.wilson@wilson-legal.example>',
			replyTo: 'jwilson.claims@gmail.com',
			subject: 'Unclaimed inheritance of a deceased client',
			text: 'Dear friend,\n\nI am a lawyer representing the estate of a deceased client who shares your surname. An amount of 4.7 million USD is unclaimed. Please reply with your full name, address and phone number so we can start the transfer.\n\nRegards,\nDr. James Wilson'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'punycode-apple',
		mail: {
			from: 'Apple <id@xn--pple-43d.com>',
			subject: 'Ihre Apple-ID wurde gesperrt',
			html: '<p>Ihre Apple-ID wurde aus Sicherheitsgründen gesperrt. Melden Sie sich an, um sie zu entsperren.</p><p><a href="https://xn--pple-43d.com/login">Apple-ID entsperren</a></p>'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'fake-microsoft-quota',
		mail: {
			from: 'Microsoft 365 <admin@mailbox-quota.example>',
			subject: 'Ihr Postfach ist zu 99 % voll',
			html: '<p>Ihr Postfach hat das Speicherlimit erreicht. Neue E-Mails werden ab heute abgewiesen.</p><p><a href="https://mailbox-quota.example/upgrade">Speicher jetzt kostenlos erweitern</a></p>'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'gift-card-ceo',
		mail: {
			from: 'Prof. Dr. Klaus Müller <prof.k.mueller.uni@gmail.com>',
			subject: 'Kurze Bitte',
			text: 'Hallo,\n\nsind Sie gerade erreichbar? Ich sitze in einer Besprechung und brauche dringend vier Amazon-Gutscheinkarten zu je 100 € für ein Geschenk. Bitte kaufen Sie sie und schicken Sie mir die Codes per Mail, ich erstatte es Ihnen morgen.\n\nKlaus Müller'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	},
	{
		id: 'lookalike-paypal-domain',
		mail: {
			from: 'PayPal Service <service@paypal-kundencheck.top>',
			subject: 'Bestätigen Sie Ihre Zahlungsdaten',
			html: '<p>Bitte bestätigen Sie Ihre Zahlungsdaten, damit Ihr PayPal-Konto aktiv bleibt.</p><p><a href="https://paypal-kundencheck.top/confirm">Daten bestätigen</a></p>'
		},
		history: none,
		expect: { tab: 'ads', phishing: true }
	}
];
