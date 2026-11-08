import Link from "next/link";
import { siteOrigin } from "@/lib/seo";
import { landingContent, type LandingLocale } from "./content";
import FeatureCatalog from "./FeatureCatalog";
import { Icon, Landscape, Portrait, Waveform } from "./Artwork";
import styles from "./LandingPage.module.css";

function Brand({ locale }: { locale: LandingLocale }) {
  return <Link href={locale === "en" ? "/" : "/hu"} className={styles.brand} aria-label="Start AI Creator"><span className={styles.brandMark}><Icon name="spark" /></span><span>Start <span className={styles.brandAi}>AI</span> Creator<span className={styles.brandDot}>.</span></span></Link>;
}

export default function LandingPage({ locale }: { locale: LandingLocale }) {
  const c = landingContent[locale];
  const schema = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Start AI Creator", applicationCategory: "MultimediaApplication", operatingSystem: "Web", url: siteOrigin() + (locale === "en" ? "/" : "/hu"), inLanguage: ["hu", "en"], description: c.intro };
  return <div lang={locale} className={styles.page} id="top">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <a href="#main" className={styles.skipLink}>{c.skip}</a>
    <header className={styles.header}>
      <div className={styles.container}>
        <Brand locale={locale} />
        <nav className={styles.mainNav} aria-label={locale === "en" ? "Main navigation" : "Fő navigáció"}>{["features", "workflow", "faq"].map((id, index) => <a href={`#${id}`} key={id}>{c.nav[index]}</a>)}</nav>
        <div className={styles.headerActions}><a className={styles.language} href={c.languageHref} hrefLang={locale === "en" ? "hu" : "en"} lang={locale === "en" ? "hu" : "en"}><Icon name="globe" />{c.language}</a><Link className={styles.signIn} href="/login" prefetch={false}>{c.login}<Icon name="arrow" /></Link></div>
      </div>
    </header>
    <div className={styles.promoBar}><div className={styles.container}><span><Icon name="spark" />{c.banner}</span><span>{c.bannerNote}<span className={styles.languageBadge}>HU / EN</span></span></div></div>
    <main id="main" className={styles.container}>
      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span className={styles.eyebrowLine} />{c.eyebrow}</p>
          <h1 id="hero-heading">{c.title}<br /><span>{c.titleAccent}</span></h1>
          <p className={styles.intro}>{c.intro}</p>
          <div className={styles.heroActions}><a className={styles.primaryButton} href="#features">{c.discover}<Icon name="arrow" /></a><a className={styles.textLink} href="#availability">{c.availabilityLink}</a></div>
          <p className={styles.heroNote}><span aria-hidden="true" />{c.heroNote}</p>
        </div>
        <figure className={styles.heroVisual} aria-label={c.heroIllustration}>
          <div className={styles.visualGrid} aria-hidden="true" />
          <div className={styles.visualTop}><span><Icon name="spark" />{c.workspaceLabel}</span><span className={styles.windowDots} aria-hidden="true"><i /><i /><i /></span></div>
          <div className={styles.heroPortrait}><Portrait id="hero-character" /><span className={styles.portraitCaption}><i />{c.characterLabel}<span>01</span></span></div>
          <div className={styles.references}><span>{c.referenceLabel}<Icon name="grid" /></span><div><div><Portrait id="reference-one" /></div><div><Portrait id="reference-two" /></div><div><Portrait id="reference-three" /></div></div></div>
          <div className={styles.heroVideo}><Landscape id="hero-landscape" /><span className={styles.playIcon} aria-hidden="true">▷</span><span className={styles.sceneCaption}>{c.sceneLabel}<Icon name="arrow" /></span></div>
          <div className={styles.heroAudio}><div><span className={styles.audioDot} />{c.voiceLabel}</div><Waveform /></div>
          <div className={styles.visualBottom}><span>{c.creativeLabel}</span><Icon name="spark" /></div>
          <figcaption>{c.illustration}</figcaption>
        </figure>
      </section>
      <div className={styles.pillars}>{c.pillars.map(([title, description], index) => <div key={title}><span className={styles.pillarIcon}><Icon name={index === 0 ? "spark" : index === 1 ? "grid" : "check"} /></span><div><strong>{title}</strong><span>{description}</span></div></div>)}</div>
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
    <footer className={styles.footer}><div className={styles.container}><div className={styles.footerTop}><div><Brand locale={locale} /><p>{c.footerText}</p></div><nav aria-label={locale === "hu" ? "Jogi információk" : "Legal information"}><Link href="/terms">{c.terms}</Link><Link href="/privacy">{c.privacy}</Link><a href={c.languageHref} hrefLang={locale === "en" ? "hu" : "en"}>{c.language}</a></nav></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} Start AI Creator. {c.footerNote}</span><a href="#top">{c.backTop} ↑</a></div></div></footer>
  </div>;
}
