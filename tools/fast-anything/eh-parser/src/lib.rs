//! Rust port of parseExHentaiListing (ExHentai compact + thumbnail listings).
//! Faithful to the cheerio implementation: same selectors, text, URL resolution.

use std::collections::HashSet;
use std::sync::OnceLock;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use scraper::{ElementRef, Html, Selector};

fn rows_sel() -> &'static Selector {
    static S: OnceLock<Selector> = OnceLock::new();
    S.get_or_init(|| Selector::parse("table.itg tr").expect("selector"))
}

fn thumb_sel() -> &'static Selector {
    static S: OnceLock<Selector> = OnceLock::new();
    S.get_or_init(|| Selector::parse("div.itg.gld > div").expect("selector"))
}

fn pages_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)([0-9]+)\s+(?:pages?|страниц)").unwrap())
}

fn rating_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"([0-9](?:\.[0-9]+)?)\s*/\s*5").unwrap())
}

fn has_class(el: &ElementRef, class: &str) -> bool {
    el.value().classes().any(|c| c == class)
}

fn text_of(el: &ElementRef) -> String {
    el.text().collect()
}

fn resolve(base: &str, href: &str) -> Option<String> {
    let base_url = url::Url::parse(base).ok()?;
    base_url.join(href).ok().map(|u| u.to_string())
}

/// All elements below `root` (cheerio `find` excludes the root).
fn descendants<'a>(root: ElementRef<'a>) -> impl Iterator<Item = ElementRef<'a>> {
    root.descendants().filter_map(ElementRef::wrap)
}

fn find_first<'a, P: FnMut(&ElementRef) -> bool>(root: ElementRef<'a>, mut pred: P) -> Option<ElementRef<'a>> {
    descendants(root).find(|e| pred(e))
}

fn find_all<'a, P: FnMut(&ElementRef) -> bool>(root: ElementRef<'a>, mut pred: P) -> Vec<ElementRef<'a>> {
    descendants(root).filter(|e| pred(e)).collect()
}

fn parse_cover(row: ElementRef, base: &str) -> Option<String> {
    let img = find_first(row, |e| e.value().name() == "img")?;
    let cover = img
        .value()
        .attr("data-src")
        .or_else(|| img.value().attr("src"))
        .unwrap_or("");
    if cover.is_empty() {
        None
    } else {
        resolve(base, cover)
    }
}

fn parse_tags(row: ElementRef) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for el in find_all(row, |e| has_class(e, "gt") || has_class(e, "gtl")) {
        let label = el
            .value()
            .attr("title")
            .map(str::to_string)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| text_of(&el));
        let label = label.trim().to_string();
        if !label.is_empty() && !out.contains(&label) {
            out.push(label);
            if out.len() >= 24 {
                break;
            }
        }
    }
    out
}

fn page_count_text(row: ElementRef) -> String {
    // `.gl4c.glhide > div` (direct children), fall back to the whole row text.
    let mut divs: Vec<ElementRef> = Vec::new();
    for holder in find_all(row, |e| has_class(e, "gl4c") && has_class(e, "glhide")) {
        for child in holder.children().filter_map(ElementRef::wrap) {
            if child.value().name() == "div" {
                divs.push(child);
            }
        }
    }
    if divs.len() >= 2 {
        text_of(&divs[1])
    } else {
        text_of(&row)
    }
}

fn make_item(url: String, title: String, cover: Option<String>, category: Option<String>, pages: Option<u64>, rating: Option<f64>, tags: Vec<String>) -> serde_json::Value {
    serde_json::json!({
        "url": url,
        "title": title,
        "coverUrl": cover,
        "thumbUrl": null,
        "category": category,
        "rating": rating,
        "pages": pages,
        "tags": tags,
        "chapterTotal": null,
    })
}

#[napi(js_name = "parseExHentaiListing", catch_unwind)]
pub fn parse_ex_hentai_listing(html: String, base: String) -> Result<serde_json::Value> {
    // assertLayout() passes when ANY marker is present, not all of them.
    let has_layout = html.contains("itg") || html.contains("glink") || html.contains("/g/");
    if !has_layout {
        return Err(Error::from_reason(
            "Парсер E-Hentai list сломался: сайт поменял вёрстку.",
        ));
    }
    let doc = Html::parse_document(&html);
    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let rows = doc.select(rows_sel());
    for row in rows {
        let a = match find_first(row, |e| {
            e.value().name() == "a" && e.value().attr("href").map(|h| h.contains("/g/")).unwrap_or(false)
        }) {
            Some(a) => a,
            None => continue,
        };
        let href = a.value().attr("href").unwrap_or("").to_string();
        if !href.contains("/g/") {
            continue;
        }
        let Some(full) = resolve(&base, &href) else { continue };
        if !seen.insert(full.clone()) {
            continue;
        }
        let base_text = text_of(&a).trim().to_string();
        let title = find_first(row, |e| has_class(e, "glink"))
            .map(|e| text_of(&e).trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                let t = base_text.clone();
                if t.is_empty() { None } else { Some(t) }
            })
            .or_else(|| a.value().attr("title").map(str::to_string))
            .unwrap_or_default();
        let cover = parse_cover(row, &base);
        let category = find_first(row, |e| has_class(e, "cn"))
            .map(|e| text_of(&e).trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                find_first(row, |e| e.value().name() == "td" && has_class(e, "glcat"))
                    .map(|e| text_of(&e).trim().to_string())
                    .filter(|s| !s.is_empty())
            });
        let pages_text = page_count_text(row);
        let pages = pages_re().captures(&pages_text).and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<u64>().ok());
        let row_text = text_of(&row);
        let rating = rating_re()
            .captures(&row_text)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<f64>().ok());
        let tags = parse_tags(row);
        results.push(make_item(full, title, cover, category, pages, rating, tags));
    }

    if results.is_empty() {
        for block in doc.select(thumb_sel()) {
            let a = match find_first(block, |e| {
                e.value().name() == "a" && e.value().attr("href").map(|h| h.contains("/g/")).unwrap_or(false)
            }) {
                Some(a) => a,
                None => continue,
            };
            let href = a.value().attr("href").unwrap_or("").to_string();
            if !href.contains("/g/") {
                continue;
            }
            let Some(full) = resolve(&base, &href) else { continue };
            if !seen.insert(full.clone()) {
                continue;
            }
            let title = find_first(block, |e| has_class(e, "glink"))
                .map(|e| text_of(&e).trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    find_first(block, |e| has_class(e, "gl1t"))
                        .map(|e| text_of(&e).trim().to_string())
                        .filter(|s| !s.is_empty())
                })
                .or_else(|| {
                    let t = text_of(&a).trim().to_string();
                    if t.is_empty() { None } else { Some(t) }
                })
                .or_else(|| a.value().attr("title").map(str::to_string))
                .unwrap_or_default();
            let block_text = text_of(&block);
            let pages = pages_re().captures(&block_text).and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<u64>().ok());
            let rating = rating_re()
                .captures(&block_text)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse::<f64>().ok());
            let category = find_first(block, |e| has_class(e, "cs"))
                .map(|e| text_of(&e).trim().to_string())
                .filter(|s| !s.is_empty());
            let tags = parse_tags(block);
            results.push(make_item(full, title, parse_cover(block, &base), category, pages, rating, tags));
        }
    }

    Ok(serde_json::Value::Array(results))
}
