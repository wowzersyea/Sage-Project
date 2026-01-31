#!/usr/bin/env python3
"""
Weekly Literature Digest Generator
===================================
Automated agent that searches medical literature and generates
a weekly digest for pediatric ID and antimicrobial stewardship.

This script is run by GitHub Actions every Sunday.
"""

import anthropic
import json
import os
from datetime import datetime, timedelta

# Initialize the Anthropic client
client = anthropic.Anthropic()

# Calculate date range for this week's digest
today = datetime.now()
week_start = today - timedelta(days=7)
date_range = f"{week_start.strftime('%B %d')} - {today.strftime('%B %d, %Y')}"
file_date = today.strftime('%Y-%m-%d')

SYSTEM_PROMPT = """You are a literature monitoring assistant for a pediatric infectious disease physician and antimicrobial stewardship director. Your job is to search for and summarize the latest publications, guidelines, and news relevant to their practice.

## Your Focus Areas:
- Pediatric infectious diseases
- Antimicrobial stewardship (especially OUTPATIENT stewardship - this is a current initiative)
- Infection prevention
- Antibiotic resistance patterns
- Vaccine updates

## Journals to Monitor (search for recent content from these):

### Tier 1 - Core Pediatric ID:
- Pediatric Infectious Disease Journal (PIDJ)
- Journal of the Pediatric Infectious Diseases Society (JPIDS)
- Pediatrics (ID-related articles)
- JAMA Pediatrics (ID-related articles)

### Tier 2 - Stewardship & General ID:
- Clinical Infectious Diseases (CID)
- Antimicrobial Agents and Chemotherapy (AAC)
- Infection Control & Hospital Epidemiology (ICHE)
- Open Forum Infectious Diseases (OFID)

### Tier 3 - High-Impact (filter for ID content):
- New England Journal of Medicine
- JAMA
- Lancet Infectious Diseases

## Guideline Sources to Check:
- IDSA (Infectious Diseases Society of America)
- PIDS (Pediatric Infectious Diseases Society)
- AAP (American Academy of Pediatrics) / Red Book
- CDC / MMWR
- FDA safety communications

## Output Format:
Structure your digest with these sections:

# 📚 Literature Digest: [DATE RANGE]

## 🚨 Practice-Changing / Action Required
Items that may require immediate attention or protocol review. If none, state "No practice-changing items identified this week."

## 📋 Guideline Updates
New or revised guidelines from IDSA, PIDS, AAP, CDC. Include publication date and key changes.

## 💊 Stewardship Highlights
Focus on outpatient stewardship content, plus relevant inpatient stewardship. This is a priority area.

## 🦠 Pediatric ID Updates
Key articles from PIDJ, JPIDS, Pediatrics, JAMA Pediatrics relevant to pediatric infectious diseases.

## 📰 General ID of Interest
Notable content from CID, NEJM, JAMA, Lancet ID that's relevant to pediatric practice.

## 💉 Vaccine & Prevention Updates
Any vaccine recommendations, schedules, or immunization-related news.

## ⚠️ Safety Communications
FDA alerts, drug shortages, recalls relevant to pediatric ID.

## Guidelines:
- Be CONCISE - 2-3 sentences per article maximum
- Focus on CLINICAL RELEVANCE and actionable findings
- Include pediatric dosing details when mentioned
- Note when something is particularly relevant to outpatient stewardship
- If you cannot find recent content for a section, note "No significant updates identified"
- Do not make up or hallucinate articles - only report what you actually find
"""

USER_PROMPT = f"""Please generate the weekly literature digest for {date_range}.

Search for:
1. Recent publications from the tracked journals (past 7-14 days)
2. Any new guidelines or guideline updates
3. CDC/MMWR publications relevant to pediatric ID
4. FDA safety communications for antibiotics/antivirals
5. Notable news in pediatric infectious diseases

Focus particularly on:
- Outpatient antimicrobial stewardship (HIGH PRIORITY)
- Pediatric-specific content
- Treatment recommendations
- Resistance patterns

Be thorough but concise. Only include items you actually find through searching - do not fabricate any articles or citations."""


def generate_digest():
    """Generate the weekly literature digest using Claude with web search."""
    
    print(f"Generating literature digest for {date_range}...")
    
    # Call Claude with web search enabled
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8000,
        tools=[{
            "type": "web_search_20250305",
            "name": "web_search"
        }],
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": USER_PROMPT
        }]
    )
    
    # Extract the text content from the response
    digest_content = ""
    for block in response.content:
        if block.type == "text":
            digest_content += block.text
    
    print("Digest generated successfully!")
    return digest_content


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
    
    # Generate the HTML page
    generate_html_page(digest_data)


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
            line-height: 1.6;
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
            margin-top: 2rem;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--sage-100);
        }}

        .digest-content h3 {{
            font-size: 1.05rem;
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
            margin-bottom: 0.75rem;
            line-height: 1.6;
        }}

        .digest-content a {{
            color: var(--accent-lavender);
            text-decoration: none;
        }}

        .digest-content a:hover {{
            text-decoration: underline;
        }}

        .digest-content strong {{
            color: var(--sage-700);
        }}

        .digest-content blockquote {{
            border-left: 3px solid var(--accent-lavender);
            padding-left: 1rem;
            margin: 1rem 0;
            color: var(--text-secondary);
            font-style: italic;
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
            <p>Automated updates from pediatric ID journals and guidelines</p>
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
                    Updated {datetime.now().strftime('%B %d, %Y')}
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
        <p>Sage Project · Literature Monitor · Automatically generated weekly</p>
    </footer>
</body>
</html>'''
    
    # Save the HTML page
    with open("literature-monitor/index.html", "w") as f:
        f.write(html_content)
    print("Updated literature-monitor/index.html")


def markdown_to_html(text):
    """Convert markdown to HTML for display."""
    import re
    
    html = text
    
    # Escape HTML entities (but preserve our markdown)
    html = html.replace('&', '&amp;')
    html = html.replace('<', '&lt;')
    html = html.replace('>', '&gt;')
    
    # Headers
    html = re.sub(r'^### (.*$)', r'<h3>\1</h3>', html, flags=re.MULTILINE)
    html = re.sub(r'^## (.*$)', r'<h2>\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r'^# (.*$)', r'<h1>\1</h1>', html, flags=re.MULTILINE)
    
    # Bold and italic
    html = re.sub(r'\*\*\*(.*?)\*\*\*', r'<strong><em>\1</em></strong>', html)
    html = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', html)
    html = re.sub(r'\*(.*?)\*', r'<em>\1</em>', html)
    
    # Links
    html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank">\1</a>', html)
    
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


if __name__ == "__main__":
    # Generate the digest
    digest_content = generate_digest()
    
    # Save it
    save_digest(digest_content)
    
    print("✅ Weekly digest generation complete!")
