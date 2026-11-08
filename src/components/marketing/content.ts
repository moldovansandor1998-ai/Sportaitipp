import type { PublicLocale } from "@/lib/public-locale";
import ro from "./locales/ro";
import it from "./locales/it";
import de from "./locales/de";
import fr from "./locales/fr";
import sk from "./locales/sk";
import pl from "./locales/pl";
export type LandingLocale = PublicLocale;
export type ToolCategory = "all" | "characters" | "images" | "video" | "audio" | "organize";
export type ToolArt = "portrait" | "image" | "video" | "audio" | "content" | "gallery";
export type Feature = {
  id: string; category: Exclude<ToolCategory, "all">; art: ToolArt;
  title: string; description: string; tags: readonly string[]; href: string; provider: boolean;
};

const baseContent = {
  hu: {
    mainNavigation: "Fő navigáció", toolCategories: "Eszközkategóriák", legalInformation: "Jogi információk", chooseLanguage: "Nyelv választása", seoTitle: "AI-karakterek, képek és videók", seoDescription: "AI-karakterek létrehozása és kezelése referenciaképekkel, kép- és videóeszközökkel, hangmunkafolyamatokkal és rendezett galériával a Start AI Creator platformon.", socialAlt: "Start AI Creator: karakterek, képek, videó és hang. AI-val készült kreatív illusztráció.", language: "English", languageHref: "/", skip: "Ugrás a tartalomra", login: "Belépés", existing: "Már van fiókod? Lépj be", nav: ["Eszköztár", "Így működik", "Kérdések"],
    banner: "A saját alkotói világod. Egy helyen.", bannerNote: "Bemutatóoldal nyolc nyelven",
    eyebrow: "AI-KARAKTEREK. KÉPEK. VIDEÓK.", title: "Az ötlet a tiéd.", titleAccent: "Az eszköztár itt van.",
    intro: "Építs saját AI-karaktert. Készíts képeket, dolgozz videóval és hanggal, majd rendezd a tartalmaidat egy közös alkotói térben.",
    discover: "Fedezd fel az eszközöket", availabilityLink: "Hozzáférés és elérhetőség", heroNote: "Meglévő fiókkal használható munkatér. Új előfizetések előkészítés alatt.",
    heroIllustration: "A karaktertől a kész tartalomig vezető munkafolyamat illusztrációja", illustration: "Munkafolyamat-illusztráció", characterLabel: "Saját karakter", referenceLabel: "Referenciák", sceneLabel: "Kép → videó", voiceLabel: "Hang és szinkron", workspaceLabel: "Alkotói munkatér", creativeLabel: "A KÖVETKEZŐ ÖTLETED HELYE",
    pillars: [["Saját karakter", "Referenciákra építve"], ["Összekapcsolt eszközök", "Kép, videó és hang"], ["Rendezett alkotás", "Projektek és galéria"]],
    catalogEyebrow: "FEDEZD FEL, MI VAN BENNE", catalogTitle: "Egy alkotó. Sok lehetőség.", catalogIntro: "Válassz munkafolyamatot, és nézd meg, mire használhatod az eszközöket.",
    search: "Keresés az eszközök között", searchPlaceholder: "Mit szeretnél készíteni?", resultCount: "eszköz", clear: "Szűrők törlése", noResults: "Nincs ilyen eszköz a listában.", noResultsHint: "Próbálj másik keresést, vagy nézd meg az összes eszközt.",
    filters: [{ id: "all", label: "Összes eszköz" }, { id: "characters", label: "Karakter" }, { id: "images", label: "Kép" }, { id: "video", label: "Videó" }, { id: "audio", label: "Hang" }, { id: "organize", label: "Tartalom és projektek" }],
    accountStatus: "Fiók szükséges", providerStatus: "AI-szolgáltató szükséges", openTool: "Megnyitás fiókkal", catalogNote: "A generáláshoz megfelelő fiókhozzáférés, kredit és beállított szolgáltató szükséges. Az eszközök és modellek elérhetősége eltérhet.",
    features: [
      { id: "characters", category: "characters", art: "portrait", title: "AI-karakterek", description: "Saját karakterprofilok, referenciaképek és verziók. Tartsd egy helyen a karakteredhez tartozó alapanyagokat.", tags: ["Karakterprofil", "Referenciák"], href: "/characters", provider: false },
      { id: "images", category: "images", art: "image", title: "Képgenerálás és szerkesztés", description: "Alkoss karakterhez kötött képeket, dolgozz referenciákból, és készíts új változatokat az elérhető képmodellekkel.", tags: ["Generálás", "Képszerkesztés"], href: "/generate", provider: true },
      { id: "video", category: "video", art: "video", title: "Videó és mozgás", description: "Vigyél mozgást a képeidbe. Képből videó és karaktermozgás a fiókodhoz elérhető modellekkel.", tags: ["Képből videó", "Mozgás"], href: "/tools", provider: true },
      { id: "audio", category: "audio", art: "audio", title: "Hang és beszélő videó", description: "Beszédkészítés, hangváltás és szájmozgás-illesztés. A magyar újraszinkronhoz külön munkafolyamat is tartozik.", tags: ["Beszéd", "Szinkron"], href: "/tools", provider: true },
      { id: "content", category: "organize", art: "content", title: "Tartalomtervezés", description: "Posztszövegek, ötletek és carousel-anyagok előkészítése. A naptár a tervezést segíti, nem jelent automatikus publikálást.", tags: ["Szövegötletek", "Tartalomnaptár"], href: "/content", provider: true },
      { id: "gallery", category: "organize", art: "gallery", title: "Galéria és projektek", description: "Rendszerezd a munkáidat, kövesd a generálási feladatokat, és térj vissza a korábbi képekhez és videókhoz.", tags: ["Médiatár", "Feladatkövetés"], href: "/gallery", provider: false },
    ] satisfies readonly Feature[],
    workflowEyebrow: "AZ ELSŐ ÖTLETTŐL A GALÉRIÁIG", workflowTitle: "Adj irányt. Alkoss. Rendszerezz.", workflowIntro: "A karaktered és az alapanyagaid összekötik a kreatív folyamatot.",
    steps: [["Alapozd meg a karaktert", "Hozd létre a profilját, és készítsd elő a használható referenciákat."], ["Válaszd ki az eszközt", "Állítsd be a feladatot, majd ellenőrizd a hozzáférést és a kreditbecslést."], ["Vidd tovább az eredményt", "Kövesd a feladat állapotát, és rendszerezd az elkészült anyagokat a galériában."]],
    availabilityEyebrow: "TUDD, MIRE SZÁMÍTHATSZ", availabilityTitle: "Átlátható hozzáférés, az első lépéstől.",
    availabilityItems: [["Meglévő fiókok", "A bejelentkezés elérhető. A munkatér használatát a fiókod jogosultságai és az egyes eszközök feltételei határozzák meg."], ["AI-generálás", "Szolgáltató- és modellfüggő. Megfelelő beállítás, hozzáférés és kredit nélkül nem minden funkció indítható."], ["Új előfizetések", "Előkészítés alatt. A nyilvános fizetés még nem indult el; ezen az oldalon nem tudsz előfizetést vásárolni."]],
    availabilityNote: "Az automatikus tartalom-előkészítés fizetős módban egyelőre szünetel. Az eredmény minősége a bemenetektől és a választott modelltől is függ.",
    faqEyebrow: "JÓ, HA TUDOD", faqTitle: "Kérdések? Kezdjük itt.", questions: [
      ["Mit tudok készíteni a Start AI Creatorrel?", "Saját AI-karaktereket kezelhetsz, képeken, videókon, hangokon és tartalomötleteken dolgozhatsz. Az eszközöket a fenti katalógus mutatja be; a tényleges használat a fiókhozzáféréstől, a kreditektől és a szolgáltatók beállításaitól függ."],
      ["Lehet már új előfizetést vásárolni?", "A nyilvános előfizetés és fizetés még előkészítés alatt áll. Végleges árakat, adókat és feltételeket vásárlás előtt kell megismerned. Meglévő fiókkal továbbra is bejelentkezhetsz."],
      ["Automatikusan közzéteszi a tartalmaimat?", "A tartalomnaptár tervezésre és állapotkövetésre szolgál. Nem ígérünk automatikus közösségi publikálást, garantált elérést vagy bevételt. A fizetős mód automatikus tartalom-előkészítése jelenleg szünetel."],
      ["Használhatom valós személy képeit?", "Csak olyan tartalommal dolgozz, amelynek használatára jogosult vagy. Valós személy felhasználásához megfelelő hozzájárulás szükséges. Kiskorúakat ábrázoló, beleegyezés nélküli vagy jogellenes tartalom létrehozása tilos."],
      ["Milyen nyelveken olvasható a bemutatóoldal?", "A bemutatóoldal angolul, magyarul, románul, olaszul, németül, franciául, szlovákul és lengyelül is olvasható. A belső munkatér nyelve ettől eltérhet; a saját tartalmaidat és promptjaidat nem fordítjuk át automatikusan. Egyes beszédfunkciók kifejezetten magyar nyelvű munkafolyamatok."],
    ],
    footerText: "A saját AI-alkotói világod.", footerNote: "AI-karakter- és tartalomkészítő platform.", terms: "Felhasználási feltételek (tervezet)", privacy: "Adatkezelés (tervezet)", backTop: "Vissza az elejére",
  },
  en: {
    mainNavigation: "Main navigation", toolCategories: "Tool categories", legalInformation: "Legal information", chooseLanguage: "Choose language", seoTitle: "AI characters, images and video tools", seoDescription: "Explore AI character, image, video and voice tools in one creative workspace. Manage references and organize your content with Start AI Creator.", socialAlt: "Start AI Creator: characters, images, video and voice. AI-generated creative illustration.", language: "Magyar", languageHref: "/hu", skip: "Skip to content", login: "Sign in", existing: "Already have an account? Sign in", nav: ["Toolbox", "How it works", "FAQ"],
    banner: "Your creative world. In one place.", bannerNote: "Overview in eight languages",
    eyebrow: "AI CHARACTERS. IMAGES. VIDEO.", title: "Your idea.", titleAccent: "Your creative toolkit.",
    intro: "Build your own AI character. Create images, work with video and voice, and bring your content together in one creative workspace.",
    discover: "Explore the tools", availabilityLink: "Access and availability", heroNote: "Workspace for existing accounts. New subscriptions are in preparation.",
    heroIllustration: "Illustration of a workflow from character to creative content", illustration: "Workflow illustration", characterLabel: "Your character", referenceLabel: "References", sceneLabel: "Image → video", voiceLabel: "Voice and lip sync", workspaceLabel: "Creative workspace", creativeLabel: "A HOME FOR YOUR NEXT IDEA",
    pillars: [["Your own character", "Built around references"], ["Connected creative tools", "Image, video and voice"], ["Organized creation", "Projects and gallery"]],
    catalogEyebrow: "EXPLORE YOUR TOOLKIT", catalogTitle: "One creator. More possibilities.", catalogIntro: "Find a workflow and discover what you can do with each tool.",
    search: "Search creative tools", searchPlaceholder: "What would you like to create?", resultCount: "tools", clear: "Clear filters", noResults: "No tools match your search.", noResultsHint: "Try another search or explore the full toolkit.",
    filters: [{ id: "all", label: "All tools" }, { id: "characters", label: "Characters" }, { id: "images", label: "Images" }, { id: "video", label: "Video" }, { id: "audio", label: "Voice" }, { id: "organize", label: "Content and projects" }],
    accountStatus: "Account required", providerStatus: "AI provider required", openTool: "Open with an account", catalogNote: "Generation requires appropriate account access, credits and a configured provider. Tool and model availability may vary.",
    features: [
      { id: "characters", category: "characters", art: "portrait", title: "AI characters", description: "Character profiles, reference images and versions. Keep the building blocks of your character together.", tags: ["Character profiles", "References"], href: "/characters", provider: false },
      { id: "images", category: "images", art: "image", title: "Image creation and editing", description: "Create character-based images, work from references and explore new variations with available image models.", tags: ["Generation", "Image editing"], href: "/generate", provider: true },
      { id: "video", category: "video", art: "video", title: "Video and motion", description: "Bring your images into motion. Work with image-to-video and character motion using models available to your account.", tags: ["Image to video", "Motion"], href: "/tools", provider: true },
      { id: "audio", category: "audio", art: "audio", title: "Voice and talking video", description: "Speech generation, voice conversion and lip sync. A dedicated workflow also supports Hungarian video redubbing.", tags: ["Speech", "Lip sync"], href: "/tools", provider: true },
      { id: "content", category: "organize", art: "content", title: "Content planning", description: "Prepare copy, ideas and carousel content. Use the calendar for planning; it does not mean automatic publishing.", tags: ["Copy ideas", "Content calendar"], href: "/content", provider: true },
      { id: "gallery", category: "organize", art: "gallery", title: "Gallery and projects", description: "Organize your work, follow generation tasks and return to your previous images and videos.", tags: ["Media library", "Task tracking"], href: "/gallery", provider: false },
    ] satisfies readonly Feature[],
    workflowEyebrow: "FROM FIRST IDEA TO GALLERY", workflowTitle: "Set the direction. Create. Organize.", workflowIntro: "Your character and reference materials connect the creative process.",
    steps: [["Build your character", "Create a profile and prepare the reference materials you have the right to use."], ["Choose your tool", "Set up the task, then review access requirements and the credit estimate."], ["Take the result further", "Follow task progress and organize completed content in your gallery."]],
    availabilityEyebrow: "KNOW WHAT TO EXPECT", availabilityTitle: "Clear access, from the first step.",
    availabilityItems: [["Existing accounts", "Sign-in is available. Your account permissions and individual tool requirements determine workspace access."], ["AI generation", "Provider and model dependent. Features need appropriate configuration, access and credits before they can run."], ["New subscriptions", "In preparation. Public payments have not launched; you cannot purchase a subscription on this page."]],
    availabilityNote: "Automatic content preparation is currently paused in paid mode. Output quality also depends on your inputs and the selected model.",
    faqEyebrow: "GOOD TO KNOW", faqTitle: "Questions? Start here.", questions: [
      ["What can I create with Start AI Creator?", "Manage your own AI characters and work on images, video, voice and content ideas. The catalog above introduces the tools. Actual use depends on account access, credits and provider configuration."],
      ["Can I buy a new subscription yet?", "Public subscriptions and payment are still in preparation. Final prices, applicable taxes and terms must be shown before purchase. Existing account holders can still sign in."],
      ["Will it publish my content automatically?", "The content calendar is for planning and status tracking. We do not promise automatic social publishing, guaranteed reach or revenue. Automatic content preparation is currently paused in paid mode."],
      ["Can I use images of real people?", "Only work with content you have the right to use. Using a real person's identity requires appropriate consent. Content involving minors, non-consensual use or unlawful activity is prohibited."],
      ["Which languages is the overview available in?", "The public overview is available in English, Hungarian, Romanian, Italian, German, French, Slovak and Polish. Workspace languages may differ; your own content and prompts are not automatically translated. Some speech features are specifically Hungarian-language workflows."],
    ],
    footerText: "Your own AI creative world.", footerNote: "An AI character and content creation platform.", terms: "Terms of service (draft)", privacy: "Privacy notice (draft)", backTop: "Back to top",
  },
} as const;

/** Widen translated text while retaining the structural catalog contract. */
type TextShape<T> = T extends string ? string : T extends readonly (infer U)[] ? readonly TextShape<U>[] : T extends object ? { readonly [K in keyof T]: TextShape<T[K]> } : T;
export type LandingCopy = Omit<TextShape<typeof baseContent.en>, "features" | "filters"> & {
  features: readonly Feature[];
  filters: readonly { id: ToolCategory; label: string }[];
};
export const landingContent = { ...baseContent, ro, it, de, fr, sk, pl } satisfies Record<LandingLocale, LandingCopy>;

export function filterFeatures(features: readonly Feature[], category: ToolCategory, query: string): readonly Feature[] {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return features.filter(feature => (category === "all" || feature.category === category)
    && words.every(word => normalize([feature.title, feature.description, ...feature.tags].join(" ")).includes(word)));
}
