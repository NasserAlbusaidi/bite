import { useEffect, useState } from "react";
import {
	applyKey,
	Badge,
	Button,
	Card,
	type Density,
	Dialog,
	dirOf,
	Icon,
	IconButton,
	iconNames,
	Keypad,
	type Lang,
	Logo,
	Money,
	QuantityStepper,
	SelectField,
	Sheet,
	Tabs,
	TextField,
	ToastProvider,
	tenantAccent,
	UiProvider,
	useToast,
} from "../src/index";

// Gallery copy is sample content, not product strings, so it lives here
// rather than in an i18n catalog.
const copy = {
	en: {
		title: "Bite UI",
		buttons: "Buttons",
		charge: "Charge",
		send: "Send to kitchen",
		hold: "Hold",
		void: "Void",
		add: "Add",
		fields: "Fields",
		phone: "Phone number",
		phoneHint: "We text you when it's ready.",
		name: "Name on the order",
		nameError: "Enter a name so the barista can call you.",
		branch: "Branch",
		azaiba: "Azaiba",
		qurum: "Qurum",
		status: "Status",
		paid: "Paid",
		preparing: "Preparing",
		late: "7 min late",
		refunded: "Refunded",
		menu: "Menu card",
		bestseller: "Bestseller",
		croissant: "Pistachio croissant",
		croissantDesc: "Laminated butter dough, pistachio cream.",
		flatWhite: "Flat white",
		oat: "Oat milk",
		money: "Money",
		refund: "Refund",
		omrSign: "With the Rial sign",
		cats: "Categories",
		coffee: "Coffee",
		bakery: "Bakery",
		cold: "Cold drinks",
		keypad: "Keypad",
		cashTaken: "Cash taken",
		overlays: "Sheet, dialog, toast",
		openSheet: "Open sheet",
		openDialog: "Open dialog",
		toast: "Show toast",
		sent: "Sent to kitchen",
		voidTitle: "Void this order?",
		voidBody:
			"The kitchen ticket is cancelled and the customer is not charged.",
		cancel: "Keep order",
		tenant: "Shop accent",
		tenantBody:
			"A shop picks its colour; the button text adapts, unreadable picks fall back to Bite lime.",
		kds: "Kitchen ticket (dark, far density)",
		icons: "Icons",
	},
	ar: {
		title: "واجهة بايت",
		buttons: "الأزرار",
		charge: "ادفع",
		send: "أرسل للمطبخ",
		hold: "تعليق",
		void: "إلغاء",
		add: "أضف",
		fields: "الحقول",
		phone: "رقم الهاتف",
		phoneHint: "نرسل لك رسالة عندما يجهز طلبك.",
		name: "الاسم على الطلب",
		nameError: "اكتب اسمًا لينادي عليك الباريستا.",
		branch: "الفرع",
		azaiba: "العذيبة",
		qurum: "القرم",
		status: "الحالة",
		paid: "مدفوع",
		preparing: "قيد التحضير",
		late: "متأخر ٧ دقائق",
		refunded: "مسترد",
		menu: "بطاقة القائمة",
		bestseller: "الأكثر طلبًا",
		croissant: "كرواسون بالفستق",
		croissantDesc: "عجينة مورقة بالزبدة وكريمة الفستق.",
		flatWhite: "فلات وايت",
		oat: "حليب الشوفان",
		money: "المبالغ",
		refund: "استرداد",
		omrSign: "مع رمز الريال",
		cats: "الأقسام",
		coffee: "القهوة",
		bakery: "المخبوزات",
		cold: "مشروبات باردة",
		keypad: "لوحة الأرقام",
		cashTaken: "المبلغ النقدي المستلم",
		overlays: "النوافذ والتنبيهات",
		openSheet: "افتح اللوحة",
		openDialog: "افتح الحوار",
		toast: "أظهر تنبيهًا",
		sent: "أُرسل إلى المطبخ",
		voidTitle: "إلغاء هذا الطلب؟",
		voidBody: "تُلغى تذكرة المطبخ ولا يُحاسب العميل.",
		cancel: "أبقِ الطلب",
		tenant: "لون المتجر",
		tenantBody:
			"يختار المتجر لونه، ويتكيف لون النص، والألوان غير المقروءة تعود إلى لون بايت.",
		kds: "تذكرة المطبخ (داكن، كثافة بعيدة)",
		icons: "الأيقونات",
	},
} as const;

const omr = { code: "OMR", decimals: 3 };
const densities: Density[] = ["comfortable", "touch", "compact", "far"];

export function Gallery() {
	const [lang, setLang] = useState<Lang>("en");
	const [theme, setTheme] = useState<"light" | "dark">("light");
	const [density, setDensity] = useState<Density>("comfortable");

	useEffect(() => {
		const html = document.documentElement;
		html.lang = lang;
		html.dir = dirOf(lang);
		html.dataset.theme = theme;
		html.dataset.density = density;
	}, [lang, theme, density]);

	return (
		<UiProvider lang={lang}>
			<ToastProvider>
				<div className="g">
					<header className="g-bar">
						<Logo height={30} />
						<span className="g-spacer" />
						<Tabs
							label="Language"
							idPrefix="lang"
							items={[
								{ id: "en", label: "English" },
								{ id: "ar", label: "العربية" },
							]}
							value={lang}
							onChange={setLang}
						/>
						<Tabs
							label="Theme"
							idPrefix="theme"
							items={[
								{ id: "light", label: "Light" },
								{ id: "dark", label: "Dark" },
							]}
							value={theme}
							onChange={setTheme}
						/>
						<Tabs
							label="Density"
							idPrefix="density"
							items={densities.map((d) => ({ id: d, label: d }))}
							value={density}
							onChange={setDensity}
						/>
					</header>
					<Sections lang={lang} />
				</div>
			</ToastProvider>
		</UiProvider>
	);
}

function Sections({ lang }: { lang: Lang }) {
	const c = copy[lang];
	const toast = useToast();
	const [qty, setQty] = useState(2);
	const [cat, setCat] = useState<"coffee" | "bakery" | "cold">("coffee");
	const [cash, setCash] = useState("");
	const [sheet, setSheet] = useState(false);
	const [dialog, setDialog] = useState(false);

	return (
		<main className="g-grid">
			<section className="g-sec">
				<h2>{c.buttons}</h2>
				<div className="g-row">
					<Button icon="check">{c.charge} 4.200</Button>
					<Button variant="secondary" iconEnd="arrow-forward">
						{c.send}
					</Button>
					<Button variant="ghost">{c.hold}</Button>
					<Button variant="danger">{c.void}</Button>
				</div>
				<div className="g-row">
					<Button size="sm">{c.add}</Button>
					<Button busy>{c.charge}</Button>
					<Button disabled>{c.hold}</Button>
					<IconButton icon="settings" label="Settings" />
					<IconButton icon="plus" label={c.add} variant="primary" />
				</div>
			</section>

			<section className="g-sec">
				<h2>{c.fields}</h2>
				<TextField
					label={c.phone}
					hint={c.phoneHint}
					inputMode="tel"
					defaultValue="9123 4567"
				/>
				<TextField label={c.name} error={c.nameError} />
				<SelectField label={c.branch} defaultValue="azaiba">
					<option value="azaiba">{c.azaiba}</option>
					<option value="qurum">{c.qurum}</option>
				</SelectField>
			</section>

			<section className="g-sec">
				<h2>{c.menu}</h2>
				<Card as="article" className="g-product">
					<Badge tone="brand">{c.bestseller}</Badge>
					<h3>{c.croissant}</h3>
					<p className="g-muted">{c.croissantDesc}</p>
					<div className="g-row g-between">
						<Money amount={1850} currency={omr} />
						<Button size="sm" icon="plus">
							{c.add}
						</Button>
					</div>
				</Card>
				<Card flat className="g-line">
					<div>
						<strong>{c.flatWhite}</strong>
						<p className="g-muted">
							{c.oat} <Money amount={200} currency={omr} signed />
						</p>
					</div>
					<QuantityStepper
						value={qty}
						onChange={setQty}
						onRemove={() => setQty(1)}
					/>
				</Card>
			</section>

			<section className="g-sec">
				<h2>{c.status}</h2>
				<div className="g-row">
					<Badge tone="success">{c.paid}</Badge>
					<Badge tone="warning">{c.preparing}</Badge>
					<Badge tone="danger">{c.late}</Badge>
					<Badge>{c.refunded}</Badge>
				</div>
				<h2>{c.money}</h2>
				<dl className="g-money">
					<dt>{c.flatWhite}</dt>
					<dd>
						<Money amount={1600} currency={omr} />
					</dd>
					<dt>{c.refund}</dt>
					<dd>
						<Money amount={-1250} currency={omr} />
					</dd>
					<dt>{c.omrSign}</dt>
					<dd>
						<Money amount={12500} currency={omr} symbol="sign" />
					</dd>
				</dl>
			</section>

			<section className="g-sec">
				<h2>{c.cats}</h2>
				<Tabs
					label={c.cats}
					idPrefix="cats"
					items={[
						{ id: "coffee", label: c.coffee },
						{ id: "bakery", label: c.bakery },
						{ id: "cold", label: c.cold },
					]}
					value={cat}
					onChange={setCat}
				/>
				<h2>{c.keypad}</h2>
				<output className="g-cash" aria-label={c.cashTaken}>
					{cash || "0"}
				</output>
				<Keypad
					extra="."
					onKey={(k) => setCash((v) => applyKey(v, k, { decimals: 3 }))}
				/>
			</section>

			<section className="g-sec">
				<h2>{c.overlays}</h2>
				<div className="g-row">
					<Button variant="secondary" onClick={() => setSheet(true)}>
						{c.openSheet}
					</Button>
					<Button variant="ghost" onClick={() => setDialog(true)}>
						{c.openDialog}
					</Button>
					<Button variant="ghost" onClick={() => toast(c.sent, "success")}>
						{c.toast}
					</Button>
				</div>
				<Sheet
					open={sheet}
					onClose={() => setSheet(false)}
					title={c.croissant}
					footer={
						<Button block onClick={() => setSheet(false)}>
							{c.add} · <Money amount={1850} currency={omr} />
						</Button>
					}
				>
					<p className="g-muted">{c.croissantDesc}</p>
				</Sheet>
				<Dialog
					open={dialog}
					onClose={() => setDialog(false)}
					title={c.voidTitle}
					footer={
						<>
							<Button variant="ghost" onClick={() => setDialog(false)}>
								{c.cancel}
							</Button>
							<Button variant="danger" onClick={() => setDialog(false)}>
								{c.void}
							</Button>
						</>
					}
				>
					<p>{c.voidBody}</p>
				</Dialog>
			</section>

			<section className="g-sec">
				<h2>{c.tenant}</h2>
				<p className="g-muted">{c.tenantBody}</p>
				<div className="g-row">
					{["#8B1E3F", "#F2C14E", "#1D4ED8", "#7A7A7A"].map((hex) => {
						const accent = tenantAccent(hex);
						return (
							<span key={hex} className="g-tenant" style={accent.vars}>
								<Button size="sm">{c.add}</Button>
								<code>
									{hex}
									{accent.usable ? "" : " ✗"}
								</code>
							</span>
						);
					})}
				</div>
			</section>

			<section className="g-sec" data-theme="dark" data-density="far">
				<h2>{c.kds}</h2>
				<Card className="g-ticket">
					<div className="g-row g-between">
						<strong className="g-ticket-no">A-142</strong>
						<Badge tone="warning">
							<Icon name="clock" /> {c.late}
						</Badge>
					</div>
					<p>
						2 × {c.flatWhite} · {c.oat}
					</p>
					<p>1 × {c.croissant}</p>
					<Button variant="primary" block icon="check">
						{c.preparing}
					</Button>
				</Card>
			</section>

			<section className="g-sec">
				<h2>{c.icons}</h2>
				<div className="g-row g-icons">
					{iconNames.map((n) => (
						<span key={n} title={n}>
							<Icon name={n} size={24} />
						</span>
					))}
				</div>
			</section>
		</main>
	);
}
