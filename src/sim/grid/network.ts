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
  nameKey?: string
  /** Free-form display name for cities, which are named rather than keyed. */
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
  lengthKm: number
  /** Number of parallel circuits; capacity and resistance scale with it. */
  circuits: number
  /** False while under construction or after a fault. */
  energised: boolean
  builtTick: number
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
