import Link from "next/link";
import Image from "next/image";
import VideoShowcase from "./VideoShowcase";
import { studioCopy } from "@/lib/studio-copy";
import { siteOrigin } from "@/lib/seo";
import { landingContent, type LandingLocale } from "./content";
import { PUBLIC_LOCALES, publicLocalePath } from "@/lib/public-locale";
import LanguagePicker from "./LanguagePicker";
import FeatureCatalog from "./FeatureCatalog";
import { Icon, Waveform } from "./Artwork";
import styles from "./LandingPage.module.css";

function Brand({ locale }: { locale: LandingLocale }) {
  return <Link href={publicLocalePath(locale)} className={styles.brand} aria-label="Start AI Creator"><span className={styles.brandMark}><Icon name="spark" /></span><span>Start <span className={styles.brandAi}>AI</span> Creator<span className={styles.brandDot}>.</span></span></Link>;
}

export default function LandingPage({ locale }: { locale: LandingLocale }) {
  const c = landingContent[locale];
  const studio = studioCopy[locale];
  const schema = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Start AI Creator", applicationCategory: "MultimediaApplication", operatingSystem: "Web", url: siteOrigin() + (publicLocalePath(locale)), inLanguage: PUBLIC_LOCALES, description: c.intro };
  return <div lang={locale} className={styles.page} id="top">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <a href="#main" className={styles.skipLink}>{c.skip}</a>
    <header className={styles.header}>
      <div className={styles.container}>
        <Brand locale={locale} />
        <nav className={styles.mainNav} aria-label={c.mainNavigation}>{["features", "workflow", "faq"].map((id, index) => <a href={`#${id}`} key={id}>{c.nav[index]}</a>)}</nav>
        <div className={styles.headerActions}><LanguagePicker locale={locale} label={c.chooseLanguage} /><Link className={styles.signIn} href="/login" prefetch={false}>{c.login}<Icon name="arrow" /></Link></div>
      </div>
    </header>
    <div className={styles.promoBar}><div className={styles.container}><span><Icon name="spark" />{c.banner}</span><span>{c.bannerNote}<span className={styles.languageBadge}>EN · HU · RO · IT · DE · FR · SK · PL</span></span></div></div>
    <main id="main" className={styles.container}>
      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span className={styles.eyebrowLine} />{c.eyebrow}</p>
          <h1 id="hero-heading">{c.title}<br /><span>{c.titleAccent}</span></h1>
          <p className={styles.intro}>{c.intro}</p>
          <div className={styles.heroActions}><a className={styles.primaryButton} href="#features">{c.discover}<Icon name="arrow" /></a><a className={styles.textLink} href="#availability">{c.availabilityLink}</a></div>
          <p className={styles.heroNote}><span aria-hidden="true" />{c.heroNote}</p>
        </div>
        <figure className={styles.cinematicVisual} aria-label={c.heroIllustration}>
          <div className={styles.cinematicMain}><Image src="/images/feature-photos/video-motion.png" alt="" fill priority sizes="(max-width: 820px) 90vw, 50vw" /><span className={styles.floatingLabel}><span />{studio.video}</span></div>
          <div className={styles.cinematicPortrait}><Image src="/images/feature-photos/image-generation.png" alt="" fill sizes="(max-width: 820px) 40vw, 260px" /><span>{c.characterLabel}</span></div>
          <div className={styles.cinematicAudio}><span>{c.voiceLabel}</span><Waveform /></div>
          <figcaption>{studio.showcaseNote}</figcaption>
        </figure>
      </section>
      <div className={styles.pillars}>{c.pillars.map(([title, description], index) => <div key={title}><span className={styles.pillarIcon}><Icon name={index === 0 ? "spark" : index === 1 ? "grid" : "check"} /></span><div><strong>{title}</strong><span>{description}</span></div></div>)}</div>
      <VideoShowcase locale={locale} />
      <FeatureCatalog locale={locale} />
      <section id="workflow" className={`${styles.section} ${styles.workflow}`} aria-labelledby="workflow-heading">
        <div className={styles.workflowHeading}><p className={styles.eyebrow}>{c.workflowEyebrow}</p><h2 id="workflow-heading">{c.workflowTitle}</h2><p>{c.workflowIntro}</p><a href="#features" className={styles.textLink}>{c.discover}<Icon name="arrow" /></a></div>
        <ol className={styles.steps}>{c.steps.map(([title, text], i) => <li key={title}><span className={styles.stepNumber}>0{i + 1}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>
      </section>
      <section id="availability" className={`${styles.section} ${styles.availability}`} aria-labelledby="availability-heading">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{c.availabilityEyebrow}</p><h2 id="availability-heading">{c.availabilityTitle}</h2></div><span className={styles.outlinedSpark}><Icon name="spark" /></span></div>
        <div className={styles.availabilityGrid}>{c.availabilityItems.map(([title, text], i) => <article key={title}><span className={`${styles.availabilityDot} ${i === 2 ? styles.pendingDot : i === 1 ? styles.configDot : ""}`} /><h3>{title}</h3><p>{text}</p></article>)}</div>
        <div className={styles.availabilityFoot}><p>{c.availabilityNote}</p><Link href="/login" prefetch={false}>{c.existing}<Icon name="arrow" /></Link></div>
      </section>
      <section id="faq" className={`${styles.section} ${styles.faq}`} aria-labelledby="faq-heading"><div><p className={styles.eyebrow}>{c.faqEyebrow}</p><h2 id="faq-heading">{c.faqTitle}</h2></div><div>{c.questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
    </main>
    <div className={styles.mobileCta}><span><strong>Start AI Creator</strong><small>{studio.prepared}</small></span><Link href="/login" prefetch={false} className={styles.primaryButton}>{c.login}<Icon name="arrow" /></Link></div>
    <footer className={styles.footer}><div className={styles.container}><div className={styles.footerTop}><div><Brand locale={locale} /><p>{c.footerText}</p></div><nav aria-label={c.legalInformation}><Link href="/terms">{c.terms}</Link><Link href="/privacy">{c.privacy}</Link><LanguagePicker locale={locale} label={c.chooseLanguage} /></nav></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} Start AI Creator. {c.footerNote}</span><a href="#top">{c.backTop} ↑</a></div></div></footer>
  </div>;
}
