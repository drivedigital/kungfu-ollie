# King Croak animation coverage

All 16 states have a plan; none are newly certified game-ready by this review. The RigLab Frog animation checklist previews the source motions and records missing work. Existing GLBs are unchanged.

| State | Source or approach | Remaining work |
|---|---|---|
| idle | Jumping Rope at 0.55× | Reduce bounce/arm circles; seamless loop; reset charge/flags |
| walkF | Dwarf Walk, user approved | In-place conversion and foot contacts |
| walkB | Adapt Dwarf Walk | Slower backward cycle and backward lean |
| jump | Jump, 0.93 s, user approved | Drive rise/fall from vertical velocity; Forward Jump alternate |
| block | New guard pose | Stable hands-up loop, also blockstun |
| light | Elbow Punch reference | Cleanup and palm adaptation; 0.55 s, hit 0.16–0.24 |
| heavy | Hook Punch reference | Current move is royal slam: author slam or deliberately change design; 0.95 s, hit 0.38–0.50 |
| special | New tongue lash | Tongue/throat motion, charge; 1.65 s, hit 0.60–0.87 |
| air | Capoeira movement reference | Current belly slam needs a dedicated pose; 0.70 s, hit 0.18–0.40 |
| hit | New recoil | Decaying wobble and shiver |
| launched | New airborne flail | Sustainable loop, also grabbed |
| down | Dying final pose candidate | Not yet visually approved; correct floor, living motion |
| ko | Dying final pose candidate | Not yet visually approved; hold limp, do not loop fall |
| getup | New supported recovery | Lying to standing in 0.55 s |
| victory | Dancing Twerk | Correct floor clipping, select seamless loop |
| intro | Joyful Jump candidate / royal greeting | Unreviewed candidate; author 2.5 s entrance ending in idle |

Timing and move identities above follow the current RigLab moves.ts; verify against the target game's current combat data at integration. Attack source clips need anticipation/contact/recovery retiming, not only uniform speed changes.

Keep Skinning Test as a diagnostic. Deprioritize Boxing and Hurricane Kick until their deformations are fixed. Retain Forward Jump as an alternate jump. For direction changes, change world travel while preserving takeoff and landing order; reversing animation time is not the same operation.

Next pass: stabilize idle/walk/jump and celebration floor contact; correct selected attacks; author guard/reactions/recovery and frog-specific special; then validate transitions, combat windows and all 16 runtime states.
