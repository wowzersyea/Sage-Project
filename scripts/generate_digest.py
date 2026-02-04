#!/usr/bin/env python3
"""
Bi-Weekly Literature Digest Generator v3.0
==========================================
Automated agent that searches medical literature and generates
a bi-weekly digest for pediatric ID and antimicrobial stewardship.

Improvements in v3.0:
- Bi-weekly schedule (every 2 weeks) for better publication coverage
- Paywall detection: marks abstract-only reviews in red
- Enhanced rigor for open access articles (full methods/results/discussion)
- PDF download for reviewed articles to sage_podcastlm/example_inputs
- Scientific rigor appropriate for ID physicians/scientists
- Critical analysis of study design and limitations
- Required links/DOIs for all articles
- Memory system to avoid repeating articles
- Strict 14-day date filtering
- Cost controls and error handling
"""

import anthropic
import json
import os
import re
import requests
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

# Initialize the Anthropic client
client = anthropic.Anthropic()

# Calculate date range for this bi-weekly digest (14 days)
today = datetime.now()
digest_start = today - timedelta(days=14)
date_range = f"{digest_start.strftime('%B %d')} - {today.strftime('%B %d, %Y')}"
file_date = today.strftime('%Y-%m-%d')
folder_date_range = f"{digest_start.strftime('%Y-%m-%d')}_to_{today.strftime('%Y-%m-%d')}"

# PDF download directory
PDF_OUTPUT_DIR = Path("f:/Coding/sage_podcastlm/example_inputs")

# Memory file path
MEMORY_FILE = "literature-monitor/digests/reviewed_articles.json"


def load_memory():
    """Load previously reviewed articles from memory file."""
    if Path(MEMORY_FILE).exists():
        with open(MEMORY_FILE, 'r') as f:
            return json.load(f)
    return {"reviewed_dois": [], "reviewed_titles": []}


def save_memory(memory):
    """Save reviewed articles to memory file."""
    # Keep only last 6 months of memory to prevent file from growing too large
    max_entries = 500
    memory["reviewed_dois"] = memory["reviewed_dois"][-max_entries:]
    memory["reviewed_titles"] = memory["reviewed_titles"][-max_entries:]

    with open(MEMORY_FILE, 'w') as f:
        json.dump(memory, f, indent=2)


def create_pdf_folder():
    """Create the folder for this digest's PDFs."""
    pdf_folder = PDF_OUTPUT_DIR / folder_date_range
    pdf_folder.mkdir(parents=True, exist_ok=True)
    return pdf_folder


def download_pdf(url, pdf_folder, title):
    """Download a PDF from a URL to the specified folder."""
    try:
        # Clean the title for use as filename
        safe_title = re.sub(r'[<>:"/\\|?*]', '', title)[:80]  # Remove invalid chars, limit length
        safe_title = safe_title.strip().replace(' ', '_')
        filename = f"{safe_title}.pdf"
        filepath = pdf_folder / filename

        # Skip if already downloaded
        if filepath.exists():
            print(f"  Already exists: {filename}")
            return str(filepath)

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        response = requests.get(url, headers=headers, timeout=30, allow_redirects=True)

        # Check if we got a PDF
        content_type = response.headers.get('content-type', '').lower()
        if 'pdf' in content_type or url.endswith('.pdf'):
            with open(filepath, 'wb') as f:
                f.write(response.content)
            print(f"  Downloaded: {filename}")
            return str(filepath)
        else:
            print(f"  Not a PDF (content-type: {content_type}): {url}")
            return None

    except Exception as e:
        print(f"  Failed to download {url}: {e}")
        return None


def extract_pdf_urls(response_text):
    """Extract PDF URLs from the digest response."""
    pdf_urls = []

    # Pattern to match PDF links in the format **PDF:** [url] or PDF: url
    pdf_pattern = r'\*\*PDF:\*\*\s*\[?([^\]\s]+\.pdf[^\s\]]*)\]?'
    matches = re.findall(pdf_pattern, response_text, re.IGNORECASE)

    # Also look for direct PDF URLs
    direct_pdf_pattern = r'(https?://[^\s<>"]+\.pdf[^\s<>"]*)'
    direct_matches = re.findall(direct_pdf_pattern, response_text, re.IGNORECASE)

    pdf_urls.extend(matches)
    pdf_urls.extend(direct_matches)

    # Remove duplicates while preserving order
    seen = set()
    unique_urls = []
    for url in pdf_urls:
        if url not in seen and url.lower() != 'paywalled':
            seen.add(url)
            unique_urls.append(url)

    return unique_urls


def extract_article_titles_for_pdfs(response_text):
    """Extract article titles paired with their PDF URLs."""
    articles = []

    # Split by article headers (bold titles)
    article_blocks = re.split(r'\n\*\*([^*]+)\*\*\n', response_text)

    for i in range(1, len(article_blocks), 2):
        if i+1 < len(article_blocks):
            title = article_blocks[i].strip()
            content = article_blocks[i+1]

            # Look for PDF URL in this block
            pdf_match = re.search(r'\*\*PDF:\*\*\s*\[?([^\]\s]+\.pdf[^\s\]]*)\]?', content, re.IGNORECASE)
            if pdf_match:
                pdf_url = pdf_match.group(1)
                if pdf_url.lower() != 'paywalled':
                    articles.append((title, pdf_url))

    return articles


def download_all_pdfs(response_text):
    """Download all PDFs mentioned in the digest."""
    pdf_folder = create_pdf_folder()
    print(f"\nDownloading PDFs to: {pdf_folder}")

    articles = extract_article_titles_for_pdfs(response_text)
    downloaded = []

    for title, url in articles:
        print(f"\nProcessing: {title[:50]}...")
        filepath = download_pdf(url, pdf_folder, title)
        if filepath:
            downloaded.append({'title': title, 'url': url, 'path': filepath})

    # Save manifest of downloaded PDFs
    if downloaded:
        manifest_path = pdf_folder / 'manifest.json'
        with open(manifest_path, 'w') as f:
            json.dump({
                'date_range': date_range,
                'generated': datetime.now().isoformat(),
                'pdfs': downloaded
            }, f, indent=2)
        print(f"\nSaved manifest to {manifest_path}")

    return downloaded


def extract_articles_from_response(response_text):
    """Extract article titles and DOIs from the response for memory."""
    # This is a simple extraction - the AI will format articles consistently
    articles = []
    lines = response_text.split('\n')
    for line in lines:
        # Look for DOI patterns
        if 'doi.org' in line.lower() or 'DOI:' in line:
            articles.append(line.strip())
        # Look for article title patterns (usually bold or in headers)
        if line.startswith('**') and '**' in line[2:]:
            title = line.split('**')[1] if len(line.split('**')) > 1 else ""
            if title and len(title) > 20:  # Likely an article title
                articles.append(title)
    return articles


SYSTEM_PROMPT = """You are a literature monitoring assistant for PEDIATRIC INFECTIOUS DISEASE PHYSICIANS AND SCIENTISTS. Your audience is highly trained specialists who expect rigorous, critical analysis.

## CRITICAL REQUIREMENTS:

### 1. ACCESS STATUS — VERY IMPORTANT
For EVERY article, you MUST determine if it is:
- **OPEN ACCESS**: Full text freely available - provide comprehensive review
- **PAYWALLED**: Only abstract available - indicate this clearly

For PAYWALLED articles, end your review with:
`[PAYWALL: Abstract only reviewed]`

For OPEN ACCESS articles, you MUST provide enhanced scientific analysis including:
- Detailed methods critique (study population, inclusion/exclusion, statistical approach)
- Key results with confidence intervals and p-values where available
- Discussion of how findings compare to existing literature
- Specific limitations with potential impact on conclusions

### 2. SCIENTIFIC RIGOR
For EVERY article you mention, you MUST include:
- Study design (RCT, retrospective cohort, case series, meta-analysis, etc.)
- Sample size (n=X)
- Key findings with actual numbers/statistics when available
- Critical limitations (selection bias, small sample, single-center, etc.)
- Clinical applicability assessment

### 3. REQUIRED LINKS AND PDF STATUS
EVERY article MUST have:
- DOI link: https://doi.org/10.xxxx/xxxxx
- Or direct PubMed link: https://pubmed.ncbi.nlm.nih.gov/XXXXXXXX/
- Or journal direct link
- If you cannot find a link, DO NOT include the article

For open access articles, also provide the PDF URL if available:
- **PDF:** [direct PDF link if available]

### 4. DATE RESTRICTION — EXTREMELY IMPORTANT
- ONLY include articles published or posted in the LAST 14 DAYS (bi-weekly digest)
- Today's date is {today_date}
- Only include articles from {start_date} to {today_date}
- DO NOT include anything published before {start_date}
- If you're unsure of the publication date, DO NOT include it

### 5. PREVIOUSLY REVIEWED — DO NOT REPEAT
The following articles have been reviewed in previous digests. DO NOT include them:
{previously_reviewed}

### 6. HONEST LIMITATIONS
- If you cannot find recent articles in a category, say "No significant publications identified this period"
- Do not fabricate or hallucinate articles
- Do not include articles you're uncertain about

## JOURNALS TO SEARCH (prioritize these):
- Pediatric Infectious Disease Journal (PIDJ)
- Journal of the Pediatric Infectious Diseases Society (JPIDS)
- Clinical Infectious Diseases (CID)
- Pediatrics (ID-relevant)
- JAMA Pediatrics (ID-relevant)
- Antimicrobial Agents and Chemotherapy
- NEJM, JAMA, Lancet ID (major findings only)

## GUIDELINE SOURCES:
- IDSA, PIDS, AAP Red Book, CDC/MMWR

## OUTPUT FORMAT:

# 📚 Literature Digest: {date_range}

## 🚨 Practice-Changing / Action Required
[Only include if truly practice-changing. Most periods this will be empty.]

## 📋 Guideline Updates
[New guidelines with links. Include key recommendation changes.]

## 💊 Stewardship Highlights
[Focus on outpatient stewardship. Include study design and critical analysis.]

## 🦠 Pediatric ID Studies
For each article:
**[Article Title]**
*[Journal], [Publication Date]* | [DOI/Link]
**PDF:** [PDF link if open access, or "Paywalled" if not]
- **Access:** [OPEN ACCESS or PAYWALLED]
- **Design:** [Study type, n=X, setting]
- **Methods:** [For open access: detailed methods critique]
- **Key Findings:** [Actual results with numbers, CIs, p-values for open access]
- **Discussion:** [For open access: how findings compare to literature]
- **Limitations:** [Critical assessment with impact on conclusions]
- **Clinical Implications:** [1-2 sentences on relevance]
[For paywalled articles, end with: `[PAYWALL: Abstract only reviewed]`]

## 📰 Notable General ID
[High-impact articles from major journals relevant to pediatrics]

## ⚠️ Safety & Drug Updates
[FDA communications, drug shortages - only if relevant to peds ID]

---
*Bi-weekly digest generated {today_date}. Articles limited to publications from {start_date} to {today_date}.*
"""


USER_PROMPT = """Generate the bi-weekly literature digest for {date_range}.

IMPORTANT REMINDERS:
1. ONLY articles from the last 14 days ({start_date} to {today_date})
2. Every article MUST have a working link (DOI or direct URL)
3. For OPEN ACCESS articles: provide FULL critical analysis of methods, results, and discussion
4. For PAYWALLED articles: review abstract only and clearly mark with [PAYWALL: Abstract only reviewed]
5. Include PDF links for open access articles when available
6. If a category has no recent publications, state that clearly
7. Do NOT include previously reviewed articles listed in the system prompt
8. Limit your web searches to be efficient - focus on the most important sources

Search strategy:
1. Search for "[Journal name] {search_month} 2026" or "[Journal name] latest issue 2026" for each key journal
2. Search "IDSA guidelines 2026" and "CDC MMWR {search_month} 2026" for guidelines
3. Search "pediatric antimicrobial stewardship 2026" for stewardship content
4. Check PMC (PubMed Central) for open access versions
5. Be selective - quality over quantity

For each article:
- Determine if full text is freely available (open access) or paywalled
- If open access: read the full paper and provide detailed methods/results/discussion analysis
- If paywalled: clearly indicate abstract-only review
- Include direct PDF links for open access articles

Provide a thorough but focused digest with full critical analysis."""


def generate_digest():
    """Generate the bi-weekly literature digest using Claude with web search."""

    print(f"Generating bi-weekly literature digest for {date_range}...")
    print(f"Date range: {digest_start.strftime('%Y-%m-%d')} to {today.strftime('%Y-%m-%d')}")

    # Load memory of previously reviewed articles
    memory = load_memory()
    previously_reviewed = "\n".join(memory.get("reviewed_titles", [])[-50:])  # Last 50 titles
    if not previously_reviewed:
        previously_reviewed = "None - this is the first digest."

    # Get search month (use current month name)
    search_month = today.strftime('%B')

    # Format the prompts with dates
    system = SYSTEM_PROMPT.format(
        today_date=today.strftime('%B %d, %Y'),
        start_date=digest_start.strftime('%B %d, %Y'),
        date_range=date_range,
        previously_reviewed=previously_reviewed
    )

    user = USER_PROMPT.format(
        date_range=date_range,
        start_date=digest_start.strftime('%B %d, %Y'),
        today_date=today.strftime('%B %d, %Y'),
        search_month=search_month
    )
    
    try:
        # Call Claude with web search enabled
        # Using lower max_tokens and being explicit about efficiency
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=6000,  # Reduced from 8000
            tools=[{
                "type": "web_search_20250305",
                "name": "web_search"
            }],
            system=system,
            messages=[{
                "role": "user",
                "content": user
            }]
        )
        
        # Extract the text content from the response
        digest_content = ""
        for block in response.content:
            if block.type == "text":
                digest_content += block.text
        
        print("Digest generated successfully!")
        
        # Update memory with newly reviewed articles
        new_articles = extract_articles_from_response(digest_content)
        memory["reviewed_titles"].extend(new_articles)
        memory["last_run"] = today.isoformat()
        save_memory(memory)
        
        return digest_content
        
    except anthropic.APIError as e:
        print(f"API Error: {e}")
        raise
    except Exception as e:
        print(f"Error generating digest: {e}")
        raise


def save_digest(content):
    """Save the digest as both JSON (for data) and update the HTML page."""
    
    # Create directories if they don't exist
    os.makedirs("literature-monitor/digests", exist_ok=True)
    
    # Save as JSON
    digest_data = {
        "date": file_date,
        "date_range": date_range,
        "generated_at": datetime.now().isoformat(),
        "content": content
    }
    
    json_path = f"literature-monitor/digests/{file_date}.json"
    with open(json_path, "w") as f:
        json.dump(digest_data, f, indent=2)
    print(f"Saved JSON digest to {json_path}")
    
    # Also save as latest.json for easy access
    with open("literature-monitor/digests/latest.json", "w") as f:
        json.dump(digest_data, f, indent=2)
    print("Updated latest.json")
    
    # Update the archive manifest
    update_archive_manifest(digest_data)
    
    # Generate the HTML page
    generate_html_page(digest_data)


def update_archive_manifest(new_digest):
    """Update the archive manifest with the new digest."""
    manifest_path = "literature-monitor/digests/manifest.json"
    
    if Path(manifest_path).exists():
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
    else:
        manifest = {"digests": []}
    
    # Add new digest to the beginning
    manifest["digests"].insert(0, {
        "date": new_digest["date"],
        "date_range": new_digest["date_range"],
        "generated": datetime.now().strftime('%B %d, %Y')
    })
    
    # Keep only last 52 weeks
    manifest["digests"] = manifest["digests"][:52]
    
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print("Updated archive manifest")


def markdown_to_html(text):
    """Convert markdown to HTML for display."""

    html = text

    # Escape HTML entities (but preserve our markdown)
    html = html.replace('&', '&amp;')
    html = html.replace('<', '&lt;')
    html = html.replace('>', '&gt;')

    # Convert paywall notices to styled HTML (do this before other processing)
    html = re.sub(
        r'\[PAYWALL:\s*Abstract only reviewed\]',
        '<span class="paywall-notice">PAYWALL: Abstract only reviewed</span>',
        html,
        flags=re.IGNORECASE
    )

    # Convert open access badges
    html = re.sub(
        r'\*\*Access:\*\*\s*OPEN\s*ACCESS',
        '<strong>Access:</strong> <span class="open-access-badge">OPEN ACCESS</span>',
        html,
        flags=re.IGNORECASE
    )
    
    # Headers
    html = re.sub(r'^#### (.*$)', r'<h4>\1</h4>', html, flags=re.MULTILINE)
    html = re.sub(r'^### (.*$)', r'<h3>\1</h3>', html, flags=re.MULTILINE)
    html = re.sub(r'^## (.*$)', r'<h2>\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r'^# (.*$)', r'<h1>\1</h1>', html, flags=re.MULTILINE)
    
    # Bold and italic
    html = re.sub(r'\*\*\*(.*?)\*\*\*', r'<strong><em>\1</em></strong>', html)
    html = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', html)
    html = re.sub(r'\*(.*?)\*', r'<em>\1</em>', html)
    
    # Links - convert markdown links to HTML
    html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', html)
    
    # Also convert bare URLs to links
    html = re.sub(r'(?<!href=")(https?://[^\s<>\)]+)', r'<a href="\1" target="_blank" rel="noopener">\1</a>', html)
    
    # Blockquotes
    html = re.sub(r'^&gt; (.*$)', r'<blockquote>\1</blockquote>', html, flags=re.MULTILINE)
    
    # Unordered lists
    html = re.sub(r'^\- (.*$)', r'<li>\1</li>', html, flags=re.MULTILINE)
    html = re.sub(r'^\* (.*$)', r'<li>\1</li>', html, flags=re.MULTILINE)
    
    # Wrap consecutive li elements in ul
    html = re.sub(r'(<li>.*?</li>\n?)+', lambda m: '<ul>' + m.group(0) + '</ul>', html)
    
    # Horizontal rules
    html = re.sub(r'^---$', r'<hr>', html, flags=re.MULTILINE)
    
    # Paragraphs - wrap text blocks
    paragraphs = html.split('\n\n')
    processed = []
    for p in paragraphs:
        p = p.strip()
        if p and not p.startswith('<h') and not p.startswith('<ul') and not p.startswith('<ol') and not p.startswith('<blockquote') and not p.startswith('<hr'):
            p = f'<p>{p}</p>'
        processed.append(p)
    
    html = '\n'.join(processed)
    
    # Clean up newlines within paragraphs
    html = re.sub(r'<p>(.*?)</p>', lambda m: '<p>' + m.group(1).replace('\n', '<br>') + '</p>', html, flags=re.DOTALL)
    
    return html


def generate_html_page(digest_data):
    """Generate the HTML page that displays the digest."""
    
    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Literature Monitor | Sage Project</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
    <style>
        :root {{
            --sage-50: #f6f7f6;
            --sage-100: #e3e7e3;
            --sage-200: #c7d0c7;
            --sage-300: #9fb0a0;
            --sage-400: #748c76;
            --sage-500: #567159;
            --sage-600: #435a46;
            --sage-700: #374839;
            --sage-800: #2d3b2f;
            --sage-900: #1a231b;
            
            --warm-50: #fefdfb;
            --warm-100: #fdf9f3;
            
            --accent-lavender: #9d8cb8;
            --accent-lavender-light: rgba(157, 140, 184, 0.15);
            
            --text-primary: #1a231b;
            --text-secondary: #567159;
            --text-muted: #748c76;
            
            --shadow-sm: 0 1px 2px rgba(26, 35, 27, 0.05);
            --shadow-md: 0 4px 12px rgba(26, 35, 27, 0.08);
            --shadow-lg: 0 12px 32px rgba(26, 35, 27, 0.12);
            
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 20px;
        }}

        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: 'Outfit', sans-serif;
            background: var(--warm-50);
            color: var(--text-primary);
            line-height: 1.7;
            min-height: 100vh;
        }}

        .bg-gradient {{
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                radial-gradient(ellipse at 20% 20%, rgba(157, 140, 184, 0.1) 0%, transparent 50%),
                radial-gradient(ellipse at 80% 80%, rgba(157, 140, 184, 0.05) 0%, transparent 50%),
                var(--warm-50);
            z-index: -1;
        }}

        header {{
            background: rgba(254, 253, 251, 0.9);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid var(--sage-100);
            padding: 1rem 2rem;
            position: sticky;
            top: 0;
            z-index: 100;
        }}

        .header-content {{
            max-width: 900px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}

        .back-link {{
            display: flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
            color: var(--text-secondary);
            font-weight: 500;
            transition: color 0.2s;
        }}

        .back-link:hover {{
            color: var(--sage-600);
        }}

        .back-link svg {{
            width: 20px;
            height: 20px;
        }}

        .logo {{
            display: flex;
            align-items: center;
            gap: 10px;
        }}

        .logo-icon {{
            width: 36px;
            height: 36px;
            background: linear-gradient(135deg, var(--sage-500), var(--sage-600));
            border-radius: var(--radius-sm);
            display: flex;
            align-items: center;
            justify-content: center;
        }}

        .logo-icon svg {{
            width: 20px;
            height: 20px;
            color: white;
        }}

        .logo-text {{
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--sage-700);
        }}

        main {{
            max-width: 900px;
            margin: 0 auto;
            padding: 2rem;
        }}

        .page-header {{
            text-align: center;
            margin-bottom: 2rem;
        }}

        .tool-badge {{
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--accent-lavender-light);
            color: var(--accent-lavender);
            padding: 0.5rem 1rem;
            border-radius: 100px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 1rem;
        }}

        .tool-badge svg {{
            width: 16px;
            height: 16px;
        }}

        .page-header h1 {{
            font-family: 'Source Serif 4', serif;
            font-size: 2.25rem;
            font-weight: 600;
            color: var(--sage-800);
            margin-bottom: 0.5rem;
        }}

        .page-header p {{
            color: var(--text-muted);
            font-size: 1.05rem;
        }}

        .digest-meta {{
            display: flex;
            justify-content: center;
            gap: 2rem;
            margin-top: 1rem;
            font-size: 0.9rem;
            color: var(--text-muted);
        }}

        .digest-meta span {{
            display: flex;
            align-items: center;
            gap: 6px;
        }}

        .digest-meta svg {{
            width: 16px;
            height: 16px;
        }}

        .digest-content {{
            background: white;
            border: 1px solid var(--sage-100);
            border-radius: var(--radius-lg);
            padding: 2.5rem;
            box-shadow: var(--shadow-sm);
        }}

        .digest-content h1 {{
            font-family: 'Source Serif 4', serif;
            font-size: 1.75rem;
            font-weight: 600;
            color: var(--sage-800);
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid var(--sage-100);
        }}

        .digest-content h2 {{
            font-size: 1.2rem;
            font-weight: 600;
            color: var(--sage-700);
            margin-top: 2.5rem;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--sage-100);
        }}

        .digest-content h3 {{
            font-size: 1.05rem;
            font-weight: 600;
            color: var(--sage-600);
            margin-top: 1.5rem;
            margin-bottom: 0.5rem;
        }}
        
        .digest-content h4 {{
            font-size: 0.95rem;
            font-weight: 600;
            color: var(--sage-600);
            margin-top: 1.25rem;
            margin-bottom: 0.5rem;
        }}

        .digest-content p {{
            margin-bottom: 1rem;
            line-height: 1.7;
        }}

        .digest-content ul, .digest-content ol {{
            margin-bottom: 1rem;
            padding-left: 1.5rem;
        }}

        .digest-content li {{
            margin-bottom: 0.5rem;
            line-height: 1.6;
        }}

        .digest-content a {{
            color: var(--accent-lavender);
            text-decoration: none;
            word-break: break-word;
        }}

        .digest-content a:hover {{
            text-decoration: underline;
        }}

        .digest-content strong {{
            color: var(--sage-700);
        }}
        
        .digest-content em {{
            color: var(--text-secondary);
        }}

        .digest-content blockquote {{
            border-left: 3px solid var(--accent-lavender);
            padding-left: 1rem;
            margin: 1rem 0;
            color: var(--text-secondary);
            font-style: italic;
        }}
        
        .digest-content hr {{
            border: none;
            border-top: 1px solid var(--sage-100);
            margin: 2rem 0;
        }}

        .paywall-notice {{
            color: #c41e3a;
            font-weight: 600;
            font-size: 0.9rem;
            background: rgba(196, 30, 58, 0.08);
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            display: inline-block;
            margin-top: 0.5rem;
        }}

        .open-access-badge {{
            color: #2e7d32;
            font-weight: 600;
            font-size: 0.85rem;
            background: rgba(46, 125, 50, 0.1);
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            display: inline-block;
        }}

        .archive-link {{
            text-align: center;
            margin-top: 2rem;
            padding-top: 1.5rem;
            border-top: 1px solid var(--sage-100);
        }}

        .archive-link a {{
            color: var(--accent-lavender);
            text-decoration: none;
            font-weight: 500;
        }}

        .archive-link a:hover {{
            text-decoration: underline;
        }}

        footer {{
            max-width: 900px;
            margin: 3rem auto 0;
            padding: 2rem;
            text-align: center;
            color: var(--text-muted);
            font-size: 0.9rem;
            border-top: 1px solid var(--sage-100);
        }}

        @media (max-width: 768px) {{
            main {{
                padding: 1rem;
            }}

            .digest-content {{
                padding: 1.5rem;
            }}

            .page-header h1 {{
                font-size: 1.75rem;
            }}

            .digest-meta {{
                flex-direction: column;
                gap: 0.5rem;
            }}
        }}
    </style>
</head>
<body>
    <div class="bg-gradient"></div>

    <header>
        <div class="header-content">
            <a href="../index.html" class="back-link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back to Dashboard
            </a>
            <div class="logo">
                <div class="logo-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <span class="logo-text">Sage</span>
            </div>
        </div>
    </header>

    <main>
        <div class="page-header">
            <div class="tool-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
                Literature Monitor
            </div>
            <h1>Weekly Literature Digest</h1>
            <p>Critical analysis for pediatric ID specialists</p>
            <div class="digest-meta">
                <span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    {digest_data['date_range']}
                </span>
                <span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    Updated {datetime.now().strftime('%B %d, %Y at %I:%M %p')}
                </span>
            </div>
        </div>

        <div class="digest-content" id="digestContent">
            {markdown_to_html(digest_data['content'])}
        </div>

        <div class="archive-link">
            <a href="archive.html">View Past Digests →</a>
        </div>
    </main>

    <footer>
        <p>Sage Project · Literature Monitor · Automated weekly with critical analysis for ID specialists</p>
    </footer>
</body>
</html>'''
    
    # Save the HTML page
    with open("literature-monitor/index.html", "w") as f:
        f.write(html_content)
    print("Updated literature-monitor/index.html")


if __name__ == "__main__":
    # Generate the digest
    digest_content = generate_digest()

    # Save the digest (JSON and HTML)
    save_digest(digest_content)

    # Download PDFs for open access articles
    print("\n" + "="*50)
    print("Downloading open access PDFs...")
    print("="*50)
    downloaded_pdfs = download_all_pdfs(digest_content)
    print(f"\nDownloaded {len(downloaded_pdfs)} PDFs")

    print("\n✅ Bi-weekly digest generation complete!")
