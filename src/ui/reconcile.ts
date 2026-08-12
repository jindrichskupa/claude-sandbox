/**
 * Patch a live panel to match a freshly rendered one, instead of replacing it.
 *
 * The inspector shows live numbers, so it cannot be cached on its content the way the other
 * panels are — it genuinely has something new to say every hour. What it was doing about that was
 * throwing the whole panel away and building it again, roughly twice a second on a running game,
 * and three things followed that all looked like separate small bugs:
 *
 *   Text in it could not be selected. The selection dies with the node it was in, so a player
 *   dragging across a number to copy it watched the highlight vanish under the cursor.
 *
 *   Hover states flickered, because the element under the pointer was a different element from
 *   one moment to the next and had never been hovered.
 *
 *   Clicks were lost. A click event is delivered to the nearest common ancestor of where the
 *   button went down and where it came up, so a control replaced between the press and the
 *   release delivers its click to the *panel* and the button does nothing. At random, perhaps
 *   half the time. The rename field works around this by opening on mousedown, which was the
 *   right fix for one control and no help to the buttons that spend money.
 *
 * The alternative to a rewrite of five hundred lines of rendering is to keep rendering exactly as
 * before, into a panel nobody can see, and then move only the differences across. An element that
 * did not change is never touched, so it keeps its selection, its hover, and — the point — its
 * identity through a press and a release.
 *
 * ## Why keeping an old element is safe here
 *
 * Reusing an element means keeping the event listeners attached to it, which is only correct if
 * those listeners would have done the same thing as the new element's. In this panel they would:
 * every listener in the inspector closes over an asset id and the callback table, both stable for
 * the life of the selection, and none of them captures a value that could go stale. Where the
 * *meaning* of a control changes — a quote that was refused becoming available, a unit that was
 * running becoming mothballed — the class or the label changes with it, and `compatible` below
 * declines to reuse the element at all.
 *
 * That is the invariant this file rests on. A future control whose listener captures a number
 * rather than an id would break it silently, which is why the rule is stated here rather than
 * left to be inferred.
 */

/**
 * Whether the live node can be updated into the new one, or has to be replaced outright.
 *
 * Tag and class for everything, and the text as well for a control. A button's label is what says
 * which action it is — "Mothball" and "Reactivate" are the same tag with the same class and
 * opposite meanings — so a control whose words changed is a different control and gets a new
 * element with a new listener.
 */
function compatible(live: Node, next: Node): boolean {
  if (live.nodeType !== next.nodeType) return false
  if (live.nodeType === Node.TEXT_NODE) return true
  if (!(live instanceof HTMLElement) || !(next instanceof HTMLElement)) return false
  if (live.tagName !== next.tagName) return false
  if (live.className !== next.className) return false
  if (live.tagName === 'BUTTON' && live.textContent !== next.textContent) return false
  return true
}

/** Copy over the handful of things this interface actually varies on an element. */
function patchAttributes(live: HTMLElement, next: HTMLElement): void {
  if (live.title !== next.title) live.title = next.title
  // Bars are drawn by setting a width and a colour, which is the one place inline style carries
  // information here. Compared as a whole string because that is how it is written.
  if (live.style.cssText !== next.style.cssText) live.style.cssText = next.style.cssText
}

/**
 * Make `live` look like `next`, touching as little as possible.
 *
 * `next` is consumed: nodes are moved out of it where they are needed. It is a detached tree
 * nobody else holds, so this is cheaper than cloning and has no observable effect.
 */
export function reconcile(live: HTMLElement, next: HTMLElement): void {
  // A field being typed into is never rebuilt under the player. The inspector already suppresses
  // rendering while the rename field is open; this is the second lock on the same door, and it is
  // the one that will still hold when somebody adds another input.
  if (live.contains(document.activeElement) && document.activeElement !== live) {
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
  }

  patchAttributes(live, next)

  const liveNodes = Array.from(live.childNodes)
  const nextNodes = Array.from(next.childNodes)

  for (let i = 0; i < nextNodes.length; i++) {
    const wanted = nextNodes[i]!
    const current = liveNodes[i]

    if (!current) {
      live.appendChild(wanted)
      continue
    }
    if (!compatible(current, wanted)) {
      live.replaceChild(wanted, current)
      continue
    }
    if (current.nodeType === Node.TEXT_NODE) {
      if (current.nodeValue !== wanted.nodeValue) current.nodeValue = wanted.nodeValue
      continue
    }
    reconcile(current as HTMLElement, wanted as HTMLElement)
  }

  // Anything the new panel no longer has. Backwards, so the indices stay valid as they go.
  for (let i = liveNodes.length - 1; i >= nextNodes.length; i--) {
    live.removeChild(liveNodes[i]!)
  }
}
