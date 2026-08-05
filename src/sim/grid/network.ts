/**
 * Network topology.
 *
 * Nodes are places (a plant site, a city, a switching substation); edges are the lines
 * between them. Two fields exist here from the first version even though nothing uses them
 * yet, because retrofitting either would mean breaking every saved game:
 *
 *   `commodity` on every edge — so the heat network can reuse this structure, the island
 *   finder and the save format unchanged.
 *
 *   `ownerId` on every node and edge — so competing utilities become an addition rather
 *   than a change to every structure in the game.
 */

import type { VoltageLevel } from '@content/lineTypes'
import type { PipeSize } from '@content/heatPipeTypes'

export type NodeId = string
export type EdgeId = string
export type OwnerId = string

export const PLAYER: OwnerId = 'player'

export type Commodity = 'electric' | 'heat'

export type NodeKind = 'plant' | 'city' | 'substation'

export interface GridNode {
  id: NodeId
  kind: NodeKind
  ownerId: OwnerId
  /** Tile coordinates on the map. */
  x: number
  y: number
  /**
   * Localisable name for things the player builds: the key names the technology and the
   * index distinguishes the third gas turbine from the first. Composed at render time so
   * switching language renames them properly.
   */
  nameKey?: string
  nameIndex?: number
  /** Free-form display name for places that are named rather than keyed, such as cities. */
  name?: string
}

export interface GridEdge {
  id: EdgeId
  commodity: Commodity
  ownerId: OwnerId
  from: NodeId
  to: NodeId
  /** Voltage level for electric edges. Heat edges carry 0. */
  kv: VoltageLevel | 0
  /**
   * Nominal bore for heat edges. Undefined on electric ones.
   *
   * A separate field rather than reusing `kv`, deliberately: DN400 pipe and 400 kV line would
   * be the same number, and a size that silently means two different things in two different
   * commodities is the kind of ambiguity that produces a bug nobody can find.
   */
  dn?: PipeSize
  lengthKm: number
  /** Number of parallel circuits, or parallel mains for a heat edge. */
  circuits: number
  /**
   * A second circuit being strung on the towers that are already there.
   *
   * Kept as a pending change on the edge rather than as a second edge, because that is what it
   * physically is: the same corridor, the same steel, another set of conductors. Modelling it as
   * a parallel line would double the drawing, double the losses bookkeeping, and give the player
   * two things to manage where the industry has one.
   */
  upgradeAtTick?: number
  upgradeToCircuits?: number
  /** False while under construction or after a fault. */
  energised: boolean
  builtTick: number
  /**
   * Physical condition, 1 being as new.
   *
   * Lines had none of this until now — a `builtTick` and nothing else — so the whole ageing,
   * maintenance and renewal half of the game applied to generation only, while the corridor was
   * scenery that never changed. Condition decays with age, is restored by re-conductoring, and
   * drives both the fault rate and a slow loss of usable rating.
   */
  conditionPct: number
  /** Tick at which a faulted line comes back. Absent when it is not faulted. */
  faultUntilTick?: number
  /** A rebuild at a higher voltage, pending. The kV it will become. */
  upgradeToKv?: VoltageLevel
  /**
   * Whether the pending work restarts the line's age.
   *
   * Re-conductoring and a voltage rebuild both do; stringing a second circuit on old towers does
   * not, because the old conductors are still up there and still the oldest thing on the line.
   */
  upgradeRenewsAge?: boolean
  /**
   * The corridor the line actually follows, as tile corners. Absent for lines that predate
   * routing, which are drawn straight.
   */
  route?: Array<{ x: number; y: number }>
}

/**
 * The graph plus the adjacency index. Mutating the graph bumps `topologyEpoch`, which is
 * what lets the island finder and the dispatch solver cache their work across the many
 * ticks in which the player builds nothing at all.
 */
export class Network {
  private readonly nodes = new Map<NodeId, GridNode>()
  private readonly edges = new Map<EdgeId, GridEdge>()
  private readonly adjacency = new Map<NodeId, EdgeId[]>()
  private _topologyEpoch = 0

  get topologyEpoch(): number {
    return this._topologyEpoch
  }

  addNode(node: GridNode): void {
    this.nodes.set(node.id, node)
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, [])
    this._topologyEpoch++
  }

  addEdge(edge: GridEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references a node that does not exist`)
    }
    this.edges.set(edge.id, edge)
    this.adjacency.get(edge.from)!.push(edge.id)
    this.adjacency.get(edge.to)!.push(edge.id)
    this._topologyEpoch++
  }

  removeEdge(id: EdgeId): void {
    const e = this.edges.get(id)
    if (!e) return
    this.edges.delete(id)
    for (const n of [e.from, e.to]) {
      const list = this.adjacency.get(n)
      if (list) this.adjacency.set(n, list.filter((x) => x !== id))
    }
    this._topologyEpoch++
  }

  /** Energising or de-energising a line changes connectivity, so it counts as topology. */
  setEnergised(id: EdgeId, energised: boolean): void {
    const e = this.edges.get(id)
    if (!e || e.energised === energised) return
    e.energised = energised
    this._topologyEpoch++
  }

  getNode(id: NodeId): GridNode | undefined {
    return this.nodes.get(id)
  }

  getEdge(id: EdgeId): GridEdge | undefined {
    return this.edges.get(id)
  }

  requireNode(id: NodeId): GridNode {
    const n = this.nodes.get(id)
    if (!n) throw new Error(`No such node: ${id}`)
    return n
  }

  requireEdge(id: EdgeId): GridEdge {
    const e = this.edges.get(id)
    if (!e) throw new Error(`No such edge: ${id}`)
    return e
  }

  /** Node ids in insertion order. Deterministic iteration matters for reproducibility. */
  nodeIds(): NodeId[] {
    return [...this.nodes.keys()]
  }

  edgeIds(): EdgeId[] {
    return [...this.edges.keys()]
  }

  allNodes(): GridNode[] {
    return [...this.nodes.values()]
  }

  allEdges(): GridEdge[] {
    return [...this.edges.values()]
  }

  edgesOf(id: NodeId): EdgeId[] {
    return this.adjacency.get(id) ?? []
  }

  /** Edges of one commodity that are currently carrying power. */
  activeEdges(commodity: Commodity): GridEdge[] {
    return this.allEdges().filter((e) => e.commodity === commodity && e.energised)
  }

  nodeCount(): number {
    return this.nodes.size
  }

  edgeCount(): number {
    return this.edges.size
  }
}

/** Straight-line tile distance, converted to kilometres by the scenario's tile scale. */
export function tileDistance(a: GridNode, b: GridNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
