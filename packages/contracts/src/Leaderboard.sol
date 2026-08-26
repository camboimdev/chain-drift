// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title Leaderboard — Chain Drift all-time player statistics
/// @notice Records finish positions and DRIFT winnings per address.
/// @dev Written by the off-chain recorder, which watches `RaceFinished` from
///      RaceEscrow. RaceEscrow itself is also authorised, so the recorder can be
///      dropped later in favour of a direct call — the reason it is not wired
///      that way today is that the payout runs inside a VRF callback with a
///      fixed gas limit, and these writes would eat into it.
contract Leaderboard is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct PlayerStats {
        uint64 wins;
        uint64 races;
        uint256 totalEarned;
    }

    struct PlayerResult {
        address player;
        /// @dev 1-based finish position; 1 is the winner.
        uint8 position;
        /// @dev DRIFT credited for this race, 0 outside the paying positions.
        uint256 payout;
    }

    /// @notice Address allowed to record results alongside the owner.
    address public recorder;

    /// @notice RaceEscrow, also allowed to record results directly.
    address public raceEscrow;

    mapping(address player => PlayerStats) public statsOf;
    mapping(uint256 raceId => bool) public raceRecorded;

    EnumerableSet.AddressSet private _players;

    error NotAuthorized(address caller);
    error EmptyResults();

    event ResultRecorded(uint256 indexed raceId, uint256 playerCount);
    event RecorderSet(address indexed recorder);
    event RaceEscrowSet(address indexed raceEscrow);

    constructor(address owner_) Ownable(owner_) {}

    // ─── Recording ──────────────────────────────────────────────────────────

    /// @notice Record one race's classification. Idempotent per `raceId`.
    /// @param results One entry per participant, ordered by finish position.
    function recordResult(uint256 raceId, PlayerResult[] calldata results) external {
        if (msg.sender != owner() && msg.sender != recorder && msg.sender != raceEscrow) {
            revert NotAuthorized(msg.sender);
        }
        if (results.length == 0) revert EmptyResults();

        // A retrying recorder must not double-count a race.
        if (raceRecorded[raceId]) return;
        raceRecorded[raceId] = true;

        for (uint256 i = 0; i < results.length; ++i) {
            PlayerResult calldata r = results[i];
            _players.add(r.player);

            PlayerStats storage s = statsOf[r.player];
            unchecked {
                ++s.races;
                if (r.position == 1) ++s.wins;
            }
            s.totalEarned += r.payout;
        }

        emit ResultRecorded(raceId, results.length);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getStats(address player) external view returns (PlayerStats memory) {
        return statsOf[player];
    }

    /// @notice Number of addresses with at least one recorded race.
    function playerCount() external view returns (uint256) {
        return _players.length();
    }

    /// @notice A page of players together with their stats, ready to rank client-side.
    /// @dev Paginated because the set grows without bound; the old contract
    ///      returned every address in one call and would eventually run out of gas.
    function getPlayers(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory players, PlayerStats[] memory stats)
    {
        uint256 total = _players.length();
        if (offset >= total) {
            return (new address[](0), new PlayerStats[](0));
        }

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 len = end - offset;

        players = new address[](len);
        stats = new PlayerStats[](len);
        for (uint256 i = 0; i < len; ++i) {
            address player = _players.at(offset + i);
            players[i] = player;
            stats[i] = statsOf[player];
        }
    }

    // ─── Owner ──────────────────────────────────────────────────────────────

    function setRecorder(address newRecorder) external onlyOwner {
        recorder = newRecorder;
        emit RecorderSet(newRecorder);
    }

    function setRaceEscrow(address newRaceEscrow) external onlyOwner {
        raceEscrow = newRaceEscrow;
        emit RaceEscrowSet(newRaceEscrow);
    }
}
