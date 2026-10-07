# Sales Navigator link rules (ICP → direct search links)

Same rule set as Olivier's GPT, so sales.gershon.ai and the GPT build links the same way.
Saved searches live in [salesnav-searches.md](salesnav-searches.md).

## Core principle
Reuse verified LinkedIn filter IDs. Never invent them.

## Verified IDs (only these are trusted)
| Filter | id | text |
|---|---|---|
| SENIORITY_LEVEL | 120 | Senior |
| SENIORITY_LEVEL | 310 | CXO |
| REGION | 102221843 | North America |
| RELATIONSHIP | S | 2nd degree connections |

No verified IDs yet for: USA, industries, titles, company headcount, function, company type, activity filters.
To add one: take a working Sales Navigator URL that contains the filter, record its id/text here with the date.

## Base structure (must be ONE line in any generated link)
https://www.linkedin.com/sales/search/people?query=(recentSearchParam:(doLogHistory:true),filters:List((type:SENIORITY_LEVEL,values:List((id:120,text:Senior,selectionType:INCLUDED),(id:310,text:CXO,selectionType:INCLUDED))),(type:REGION,values:List((id:102221843,text:North%20America,selectionType:INCLUDED))),(type:RELATIONSHIP,values:List((id:S,text:2nd%20degree%20connections,selectionType:INCLUDED)))))&viewAllFilters=true

Extra filters go inside the same `filters:List(...)`:
`(type:FILTER_NAME,values:List((id:VALUE,text:TEXT,selectionType:INCLUDED)))`
Exclusions use `selectionType:EXCLUDED` — only when that filter's representation is verified.

## Rules
1. Start from the ICP: geography, seniority, titles, industries, company size, functions, company type, relationship, engagement signals.
2. Map: geography → REGION · seniority → SENIORITY_LEVEL · role → TITLE · industry → INDUSTRY · size → COMPANY_HEADCOUNT · department → FUNCTION · company traits → COMPANY_TYPE · warm intros → RELATIONSHIP · intent → activity filters. Use a filter only when its structure and IDs are verified.
3. A working URL from Olivier is the source of truth: parse it, keep its IDs and syntax, change only the ICP-specific criteria.
4. Strip sessionId, tracking tokens, temporary IDs and any session parameters from reusable links.
5. Never guess IDs. Build the strongest valid link and list the filters to apply manually.
6. One search per persona (CEO/Founder, COO/Operations, VP/Director, Procurement, Technology, CFO/Finance), not one overloaded search.
7. Include buyers; exclude competitors, recruiters, consultants, students, irrelevant industries — when the representation is known.
8. URL-encode text values (e.g. `Chief%20Executive%20Officer`) while keeping the nested `( ) : ,` syntax intact.
9. Never break a link across lines — LinkedIn drops the filters.

## Output for every request
- ICP → filter mapping
- Persona-specific direct links (raw URL + clickable)
- Fallback standard LinkedIn searches
- Filters still to apply manually
