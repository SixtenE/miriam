# Miriam EV3 simulator

React 19 + TypeScript + Vite, with Three.js, React Three Fiber, Drei, and React Three Rapier.

## Run

```sh
pnpm install
pnpm dev
```

The course follows the supplied L-shaped map: a top wall and a left wall, open on the right and bottom. Start defaults to 2 m from the left wall and 0.5 m from the top wall, facing the top wall. X sits against the top wall 2 m right of Start; Y sits against the left wall 1 m below the corner by default; its distance is configurable from 1–5 m to test the updated assignment. Each wall extends 1 m beyond its target. Green semicircles mark the 0.5 m delivery tolerance; goods belong against the wall.

Course settings allow Start 1–3 m from the left wall and 0.25–0.75 m from the top wall. Wall extensions are at least 1 m. Wall height defaults to 30 cm. Applying settings resets the simulation. Heading is configurable because the reference does not specify it.

Use the overhead/orbit switch to inspect the scene. Run the EV3 program to drive the robot. The simulator has no manual driving mode. Pause freezes simulation time. Reset rebuilds the physics world and the interpreter.

## Sensors and movement

The floor and both walls have fixed Rapier colliders. Ultrasonic port 1 casts a ray from the sensor at 15 cm above the floor, with a 255 cm maximum range. Its default forward offset is 25 cm, so the default Start reading is 50 − 25 = **25 cm**. Visible dashed rays end at the reported hit.

The kinematic robot uses a conservative 25 cm spherical body envelope. Rapier shape sweeps limit proposed translation against the two physical walls; no bounds stop motion through the open sides. The body stops at a 1 mm clearance. Wheel speed is provisionally 2 rotations/second at full power, 5.684 rotations/metre, with a 28 cm track width.

Touch ports 2 and 3 are upward-facing buttons on top of the robot. Use the clickable sensor buttons in the top strip to supply presses to the program.

## EV3 program execution

Switch Control mode to EV3 program, then run finish_8. A cooperative interpreter advances on the same 60 Hz clock as the physics. The panel highlights active statements and sensor waits across concurrent scripts, including steps inside custom functions.

The interpreter supports the imported project's variables, arithmetic/Boolean expressions, custom arguments, conditional branches, repeat-until loops, timed and sensor waits, broadcasts and broadcast-and-wait, touch edge events, gyro resets, and motor commands. Unsupported commands raise a visible error and stop motor output. Detached stacks do not run automatically.

This is an initial simulator, not hardware-equivalent EV3 execution. Sound is silent with a placeholder 0.5-second blocking duration. Clamp motors track idealized rotations without a physical clamp. Motor encoders advance from commanded speeds even when translation is blocked. Gyro equality waits also detect threshold crossing between samples. Coast/brake commands are accepted but both use immediate motor stopping. The carried can and clamp are simplified; the released can is a dynamic Rapier cylinder. The clamp lowers it directly to the floor upright rather than simulating jaws or a drop.

## Verification

With Node 24 or newer:

```sh
pnpm test
pnpm build
pnpm lint
```

Tests cover map dimensions, configurable Start distances, finite walls and open sides, cooperative waits, broadcast concurrency, custom arguments, touch waits, imported startup, Rapier ultrasonic rays, wall sweeps, front contacts, and rejection of side-only touch.

## Live code debugger

The code viewer beside the arena uses the preserved source block IDs. It displays all 13 event scripts and six functions as expandable EV3 Classroom-style colored stacks, with input pills, colored sensor/operator reporters, and nested loop/condition cavities. Each script has a status: idle, running, waiting, finished, breakpoint, or error.

- Green marks the current instruction; amber marks a movement, timed, sensor, or broadcast wait.
- Blue outlines mark active caller/loop/condition context, including calls into separately expanded function definitions.
- Instant completions flash for 650 ms using display wall time. Their real completion is recorded immediately in the simulation event log, even if no rendered frame showed the instruction running.
- Follow mode expands active context and scrolls only the code pane. Disable it to browse freely.
- Click an instruction to inspect its requested input values and current progress. Parallel invocations of the same function keep separate values by script; the inspector lets you choose which script to inspect.
- Breakpoint dots pause the shared clock before the instruction runs. Continue bypasses that breakpoint once; future visits stop again. Breakpoints survive resets within the current page session.
- Step 1 tick advances exactly 1/60 second while paused. It permits the pending instruction through a breakpoint for that one tick, then stays paused.

The interpreter publishes `block-enter`, `block-wait`, `block-complete`, and `script-stop` events with scriptId, runId, blockId, context, simulation time, and a sequence number. Its subscribe() API provides live events; snapshots include script status, inspection values, and the most recent 300 events. A wait transition is logged once rather than once per tick. Script stops distinguish natural completion, interruption by another script, and errors. Empty scripts identify their event hat block.

The fixed-clock coordinator asks the interpreter to admit a tick before applying robot motion or stepping Rapier. A breakpoint therefore stops the clock and the robot together. Debugger tests cover event ordering, pre-execution pauses, exact stepping, movement progress, nested contexts, shared function calls, subscriptions, and interrupted scripts.

## Can delivery mission

Choose the teacher’s destination, then **New mission · random direction** to load a fresh can and randomize heading over 0–359°. The can is 13.5 cm tall, 5.5 cm in diameter, and weighs 250 g. Robot geometry remains simplified; no claim is made that it matches the EV3 kit inventory.

The simulator presses and releases the program’s touch 3 input for X or touch 2 for Y after startup variables are initialized. The imported selection sequence takes about 9 seconds to close the clamp and confirm its path. The source program is unchanged. Saved X/Y button variables are reset to unpressed in the simulation. Completion of the clockwise motor B command in `drop off` releases the can.

A successful delivery requires the can to rest within 0.5 m of the selected target and against the relevant wall, with its opening on top. Simulator allowances: up to 3 cm wall gap, at most 15° tilt, and at most 3 cm/s linear speed. These numerical allowances are simulator choices, not extra course rules. Return is recorded after stopping within 20 cm of the original Start for one second. Elapsed time is shown without imposing an invented time limit. New mission saves the preceding attempt in page-session history.

The current environment uses a flat floor and plain walls. It does not assess drink agitation, damage, wall fixtures, slopes, detachable LEGO pieces, inventory restrictions, or accessory costs. Acceleration and turning diagnostics are recorded without claiming they measure damage or shaking. The released can has physical mass, friction, collision response, and tilt.

Mission tests cover both targets, extended Y, rejecting wrong placement/wall gaps/tipping/motion, release and stopped return, both target inputs in the actual imported EV3 program, and stable resting can physics.

## Classroom-style interface

The top hardware strip continuously shows ultrasonic port 1, touch ports 2/3, gyro port 4, and the commanded motor outputs A–D. The gyro reading follows the interpreter’s reset offset. Updates follow the existing simulation telemetry refresh. The strip floats over the fullscreen arena and scrolls horizontally on narrow screens.

The code workspace uses the reference category colors: blue motors, pink movement, purple sound, yellow events, amber control, cyan sensors, green operators, orange variables, and red custom functions. Stacks show all branches initially and can be folded individually or together. Inputs and nested expressions are displayed as rounded fields/reporters. The code remains a viewer; block clicks inspect values and breakpoint dots still pause execution. Running, waiting, and calling context use outlines so the category colors remain visible.

The touch sensors in the top strip are momentary buttons. Hold with the mouse or touch, or hold Space/Enter while focused. Release, cancellation, focus loss, or leaving the window clears the button press. A quick click lasts at least 200 ms so the shared simulation clock can observe it. These presses feed the EV3 program’s touch sensor inputs. Paused presses update live readings but do not advance program time.
