/**
 * Minimum-cost flow, by successive shortest paths with potentials.
 *
 * This is the solver the whole game rests on. Generators become arcs out of a super source
 * priced at their marginal cost, demand becomes arcs into a super sink, and transmission
 * lines become capacitated arcs in between. Minimising cost then does two jobs at once:
 * it dispatches plants in merit order *and* it respects line limits, which a simple
 * supply-and-demand balance cannot do.
 *
 * The dual variables fall out for free, and they are the reason to prefer this formulation:
 * the potential at a node is the marginal cost of delivering one more MW there — a nodal
 * price. When a corridor saturates, prices on the two sides separate on their own. No
 * special-case code produces that; it is simply what the mathematics says, and it is what
 * makes reinforcing the grid a decision the player can reason about.
 */

/** Numerical tolerance. Flows are in MW, so a milliwatt is comfortably nothing. */
const EPS = 1e-9

class MinHeap {
  private readonly keys: number[] = []
  private readonly vals: number[] = []

  get size(): number {
    return this.vals.length
  }

  push(key: number, val: number): void {
    this.keys.push(key)
    this.vals.push(val)
    let i = this.vals.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p]! <= this.keys[i]!) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): { key: number; val: number } {
    const key = this.keys[0]!
    const val = this.vals[0]!
    const lastKey = this.keys.pop()!
    const lastVal = this.vals.pop()!
    if (this.vals.length > 0) {
      this.keys[0] = lastKey
      this.vals[0] = lastVal
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.vals.length && this.keys[l]! < this.keys[m]!) m = l
        if (r < this.vals.length && this.keys[r]! < this.keys[m]!) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return { key, val }
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!
    this.keys[a] = this.keys[b]!
    this.keys[b] = k
    const v = this.vals[a]!
    this.vals[a] = this.vals[b]!
    this.vals[b] = v
  }
}

export interface FlowResult {
  /** Total flow delivered from source to sink. */
  flow: number
  /** Total cost of that flow. */
  cost: number
  /**
   * Node potentials after the final iteration. `potential[v]` is the marginal cost of
   * delivering one more unit to node `v` — the nodal price.
   */
  potential: Float64Array
  /** True if the solver hit its iteration guard rather than converging. */
  aborted: boolean
}

export class MinCostFlowSolver {
  private readonly head: Int32Array
  private readonly nextEdge: Int32Array
  private readonly to: Int32Array
  private readonly cap: Float64Array
  private readonly cost: Float64Array
  private edgeCount = 0

  private readonly dist: Float64Array
  private readonly potential: Float64Array
  private readonly prevEdge: Int32Array
  private readonly visited: Uint8Array

  constructor(
    private readonly nodeCount: number,
    maxEdges: number,
  ) {
    const cap2 = maxEdges * 2
    this.head = new Int32Array(nodeCount).fill(-1)
    this.nextEdge = new Int32Array(cap2)
    this.to = new Int32Array(cap2)
    this.cap = new Float64Array(cap2)
    this.cost = new Float64Array(cap2)
    this.dist = new Float64Array(nodeCount)
    this.potential = new Float64Array(nodeCount)
    this.prevEdge = new Int32Array(nodeCount)
    this.visited = new Uint8Array(nodeCount)
  }

  reset(): void {
    this.head.fill(-1)
    this.potential.fill(0)
    this.edgeCount = 0
  }

  /** Add a directed arc with a residual counterpart. Returns the arc index. */
  addArc(from: number, to: number, capacity: number, unitCost: number): number {
    const e = this.edgeCount
    this.to[e] = to
    this.cap[e] = capacity
    this.cost[e] = unitCost
    this.nextEdge[e] = this.head[from]!
    this.head[from] = e

    const r = e + 1
    this.to[r] = from
    this.cap[r] = 0
    this.cost[r] = -unitCost
    this.nextEdge[r] = this.head[to]!
    this.head[to] = r

    this.edgeCount += 2
    return e
  }

  /** Flow currently pushed through an arc, read back from its residual pair. */
  flowOf(arc: number): number {
    return this.cap[arc + 1]!
  }

  /**
   * Push up to `maxFlow` units from `s` to `t` as cheaply as possible.
   *
   * All arc costs must be non-negative on entry, which they are here: generator costs are
   * prices and transmission costs are small positive penalties. That lets the first Dijkstra
   * run without a Bellman-Ford warm-up.
   */
  solve(s: number, t: number, maxFlow: number): FlowResult {
    let flow = 0
    let cost = 0
    // Each iteration saturates at least one arc, so twice the arc count is a generous guard.
    const guard = this.edgeCount * 2 + this.nodeCount * 4 + 64
    let iterations = 0

    while (flow < maxFlow - EPS) {
      if (++iterations > guard) {
        return { flow, cost, potential: this.potential, aborted: true }
      }
      if (!this.dijkstra(s, t)) break

      // Bottleneck along the augmenting path.
      let push = maxFlow - flow
      for (let v = t; v !== s; ) {
        const e = this.prevEdge[v]!
        push = Math.min(push, this.cap[e]!)
        v = this.to[e ^ 1]!
      }
      if (push <= EPS) break

      for (let v = t; v !== s; ) {
        const e = this.prevEdge[v]!
        this.cap[e]! -= push
        this.cap[e ^ 1]! += push
        cost += push * this.cost[e]!
        v = this.to[e ^ 1]!
      }
      flow += push
    }

    return { flow, cost, potential: this.potential, aborted: false }
  }

  /** Dijkstra over reduced costs. Returns false when the sink is unreachable. */
  private dijkstra(s: number, t: number): boolean {
    this.dist.fill(Infinity)
    this.visited.fill(0)
    this.dist[s] = 0

    const heap = new MinHeap()
    heap.push(0, s)

    while (heap.size > 0) {
      const { key, val: u } = heap.pop()
      if (this.visited[u]) continue
      if (key > this.dist[u]! + EPS) continue
      this.visited[u] = 1

      for (let e = this.head[u]!; e !== -1; e = this.nextEdge[e]!) {
        if (this.cap[e]! <= EPS) continue
        const v = this.to[e]!
        if (this.visited[v]) continue
        // Reduced cost is non-negative by construction of the potentials.
        const reduced = this.cost[e]! + this.potential[u]! - this.potential[v]!
        const nd = this.dist[u]! + reduced
        if (nd < this.dist[v]! - EPS) {
          this.dist[v] = nd
          this.prevEdge[v] = e
          heap.push(nd, v)
        }
      }
    }

    if (!Number.isFinite(this.dist[t]!)) return false

    // Shift potentials so reduced costs stay non-negative for the next round.
    for (let v = 0; v < this.nodeCount; v++) {
      if (Number.isFinite(this.dist[v]!)) this.potential[v]! += this.dist[v]!
    }
    return true
  }
}
