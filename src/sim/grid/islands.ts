/**
 * Grid islands — the connected components of the network.
 *
 * An island is the unit within which supply must match demand. Two halves of a country
 * joined by nothing are two separate problems, and a city in an island with no generation
 * goes dark no matter how much spare capacity exists elsewhere. This is recomputed only
 * when the topology actually changes, which in practice is a handful of ticks out of
 * thousands.
 */

import type { Commodity, EdgeId, Network, NodeId } from './network'

class UnionFind {
  private readonly parent: number[]
  private readonly rank: number[]

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = new Array<number>(n).fill(0)
  }

  find(x: number): number {
    let root = x
    while (this.parent[root] !== root) root = this.parent[root]!
    // Path compression, iterative to avoid deep recursion on long chains.
    let cur = x
    while (this.parent[cur] !== root) {
      const next = this.parent[cur]!
      this.parent[cur] = root
      cur = next
    }
    return root
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (this.rank[ra]! < this.rank[rb]!) this.parent[ra] = rb
    else if (this.rank[ra]! > this.rank[rb]!) this.parent[rb] = ra
    else {
      this.parent[rb] = ra
      this.rank[ra]!++
    }
  }
}

export interface Islands {
  /** Island index per node id. */
  islandOf: Map<NodeId, number>
  /** Node ids grouped by island. */
  members: NodeId[][]
  /** Edge ids grouped by island. */
  edges: EdgeId[][]
  count: number
}

/** Compute connected components over the energised edges of one commodity. */
export function computeIslands(network: Network, commodity: Commodity): Islands {
  const nodeIds = network.nodeIds()
  const indexOf = new Map<NodeId, number>()
  nodeIds.forEach((id, i) => indexOf.set(id, i))

  const uf = new UnionFind(nodeIds.length)
  for (const e of network.activeEdges(commodity)) {
    const a = indexOf.get(e.from)
    const b = indexOf.get(e.to)
    if (a === undefined || b === undefined) continue
    uf.union(a, b)
  }

  const rootToIsland = new Map<number, number>()
  const islandOf = new Map<NodeId, number>()
  const members: NodeId[][] = []

  nodeIds.forEach((id, i) => {
    const root = uf.find(i)
    let island = rootToIsland.get(root)
    if (island === undefined) {
      island = members.length
      rootToIsland.set(root, island)
      members.push([])
    }
    islandOf.set(id, island)
    members[island]!.push(id)
  })

  const edges: EdgeId[][] = members.map(() => [])
  for (const e of network.activeEdges(commodity)) {
    const island = islandOf.get(e.from)
    if (island !== undefined) edges[island]!.push(e.id)
  }

  return { islandOf, members, edges, count: members.length }
}

/**
 * Caches island computation against the network's topology epoch, so the common case —
 * nothing was built this tick — costs a single integer comparison.
 */
export class IslandCache {
  private cached: Islands | null = null
  private cachedEpoch = -1

  constructor(
    private readonly network: Network,
    private readonly commodity: Commodity,
  ) {}

  get(): Islands {
    if (this.cached === null || this.cachedEpoch !== this.network.topologyEpoch) {
      this.cached = computeIslands(this.network, this.commodity)
      this.cachedEpoch = this.network.topologyEpoch
    }
    return this.cached
  }
}
