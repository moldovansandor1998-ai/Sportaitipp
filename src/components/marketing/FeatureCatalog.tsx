"use client";
import { useState } from "react";
import Link from "next/link";
import { filterFeatures, landingContent, type LandingLocale, type ToolCategory } from "./content";
import { Icon, ToolArtwork } from "./Artwork";
import styles from "./LandingPage.module.css";

export default function FeatureCatalog({ locale }: { locale: LandingLocale }) {
  const c = landingContent[locale];
  const [category, setCategory] = useState<ToolCategory>("all");
  const [query, setQuery] = useState("");
  const features = filterFeatures(c.features, category, query);
  function clear() { setCategory("all"); setQuery(""); }
  return <section id="features" className={`${styles.section} ${styles.catalog}`} aria-labelledby="features-heading">
    <div className={styles.sectionHeading}>
      <div><p className={styles.eyebrow}>{c.catalogEyebrow}</p><h2 id="features-heading">{c.catalogTitle}</h2><p>{c.catalogIntro}</p></div>
      <div className={styles.search}><Icon name="search" /><input aria-label={c.search} type="search" placeholder={c.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} /></div>
    </div>
    <div className={styles.catalogToolbar}>
      <div className={styles.filters} role="group" aria-label={locale === "hu" ? "Eszközkategóriák" : "Tool categories"}>
        {c.filters.map(filter => <button type="button" key={filter.id} onClick={() => setCategory(filter.id)} aria-pressed={category === filter.id}>{filter.id === "all" && <Icon name="grid" />}{filter.label}</button>)}
      </div>
      <span className={styles.resultCount} role="status" aria-live="polite">{features.length} {c.resultCount}</span>
    </div>
    <div className={styles.featureGrid}>
      {features.map(feature => <article className={styles.featureCard} key={feature.id}>
        <ToolArtwork art={feature.art} id={`catalog-${feature.id}`} />
        <div className={styles.featureBody}>
          <span className={`${styles.featureStatus} ${feature.provider ? styles.providerStatus : ""}`}><i />{feature.provider ? c.providerStatus : c.accountStatus}</span>
          <h3>{feature.title}</h3><p>{feature.description}</p>
          <ul className={styles.tags}>{feature.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
          <Link href={feature.href} prefetch={false} className={styles.cardLink} aria-label={`${c.openTool}: ${feature.title}`}>{c.openTool}<Icon name="arrow" /></Link>
        </div>
      </article>)}
    </div>
    {features.length === 0 && <div className={styles.empty}><Icon name="search" /><h3>{c.noResults}</h3><p>{c.noResultsHint}</p><button type="button" onClick={clear}>{c.clear}</button></div>}
    <p className={styles.catalogNote}><span aria-hidden="true">i</span>{c.catalogNote}</p>
  </section>;
}
