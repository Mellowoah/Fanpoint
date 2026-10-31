# Demo video script

## Final (used in the published video, 2:14): https://youtu.be/hYqWay1lRb8

Recorded on the live site with live Qloo data (Japanese Breakfast: New York 11/13, Durham 11/21, Atlanta 11/28; co-headliner pair Black Pumas × Men I Trust). The voice-over and subtitles are these lines, verbatim:

1. **Booked shows.** An empty night on tour still costs hotel rooms, per diems and fuel. Fanpoint is a routing desk: enter the shows you've already booked, and it fills the nights in between.
2. **Fill the gaps (live run).** One click runs a live agent on Qloo. It maps where Japanese Breakfast's fans are along each drive, drops any city that breaks a touring rule, and fills the open dates: 8 of 13, with zero shows that break touring limits. Each stop gets a room, an opener and what those fans also like.
3. **Receipts.** Every pick has a receipt. Why this stop cites its sources, and Receipts lists every city considered, why it was or wasn't booked, and every Qloo request the agent made.
4. **With vs without Qloo.** Turn Qloo off and you get the biggest cities, with no fans behind them. Next to a plain AI chatbot on the same dates, Fanpoint fills 8 of 13 open dates; the chatbot fills 5.
5. **Co-headliner match.** Co-headliner match compares two acts' fan maps city by city, so you can see where each one brings the crowd the other lacks.
6. **The routing desk.** Then it's a desk you can work from. The empty nights it filled would have cost about seven thousand dollars at the default planning numbers, which you can edit. Export every stop to CSV, copy a hold request, see sponsor ideas from Qloo taste data, and open a draft ad pack for Meta, X and Snapchat. Nothing is posted or spent.
7. **Wrap-up.** So from one screen, you can find the right room and send the hold, see what this audience is paying attention to, and plan your ads and local events around it.
8. **Close.** Fanpoint, a tour routing desk built on Qloo. It's live now, and the code is open source.

## Earlier draft, about 2:00 (superseded)

*Audience: a Live Nation-style promoter or booking exec. Format: a live screen capture of the deployed app with live Qloo
data, no slides. Write the final voice-over in your own words. Upload as public and "Not for Kids", and check it once in
an incognito window. Do not quote statistics you haven't verified at the primary source. This draft uses none.*

| Time | On screen | Voice-over (draft) |
|---|---|---|
| 0:00–0:10 | The calendar strip with three anchors and grey **OFF** tiles between them | "Three confirmed dates: a release show in Brooklyn, a festival in Durham, a support slot in Atlanta. Thirteen nights in between. Every one is either a show or an empty night." |
| 0:10–0:22 | Logo, then the header line | "An empty night on tour still costs a hotel, a van and a crew. Fanpoint fills those nights for booking agents and promoters. Fixed dates in, gap cities with drive times out. Two acts in, a complementary fan map out. Built on Qloo." |
| 0:22–0:50 | Press **Fill the gaps**. The trace streams: resolve, then two `urn:heatmap` corridor calls. The corridors light up on the map | "For each drive between anchors, Fanpoint pulls the act's Qloo fan heatmap inside that corridor, a polygon around the route. Each city along the way gets its fan heat. Those numbers come from Qloo, not the model." |
| 0:50–1:10 | Scroll to **Corridor candidates → realistic fills**. Point at crossed-out cities | "Then the rules a promoter would apply: no shows inside the festival's radius, no doubling back, no day over 350 miles, and a Monday has to earn its place over a night off. Each removed city shows why." |
| 1:10–1:25 | The calendar fills in. Hover a fill card: miles, hours, rank, support act, room | "Thirteen off nights down to [N, live number]. Each fill shows the drive in miles and hours, its rank in the corridor, a local support act no bigger than the headliner, and the rooms this audience prefers." |
| 1:25–1:40 | Toggle **Plain AI**, then **Compare**. The red flags show | "Same dates, same model, no Qloo. It fills every night with familiar markets, and our audit flags a show inside the Brooklyn radius and a leg that doubles back. And its venues aren't real entities." |
| 1:40–1:55 | **Co-headliner match**, with the coloured map | "Second question: who to co-headline with. The most similar act shares your cities, so it's the same rooms and the same fans. Fanpoint scores complementarity from both acts' Qloo heatmaps. Orange is where you carry the room, teal is where they do." |
| 1:55–2:05 | Live URL and repo on screen; the trace tab open | "Every number traces to a Qloo request. Fanpoint is for the people who book and route shows: fewer empty nights, and co-bills where each act brings its own markets." |

**Shot list:** prewarm the server; use the live demo act and anchors you verified; keep the cursor slow; record at 1440×900.
Keep the browser bar visible for one shot so the deployed URL shows. Keep the total between 1:45 and 2:15.
