import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

import ContestPlayer from "./contest_player";
import JudgeState from "./judge_state";

@TypeORM.Entity()
export default class ContestRanklist extends Model {
  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "json" })
  ranking_params: any;

  @TypeORM.Column({ default: JSON.stringify([]), type: "json" })
  players: any[];

  async updatePlayer(contest, player, skipSort = false) {
    let players = this.players || [];
    let rankedPlayer = null;

    // 查找是否已存在该玩家
    for (let i = 0; i < players.length; i++) {
      if (players[i].user_id === player.user_id) {
        rankedPlayer = players[i];
        rankedPlayer.player_id = player.id;
        break;
      }
    }

    if (rankedPlayer === null) {
      rankedPlayer = {
        player_id: player.id,
        user_id: player.user_id,
      };
      players.push(rankedPlayer);
    }  
    rankedPlayer.latest = 0;
    rankedPlayer.score = 0;
    rankedPlayer.timeSum = 0;

    if (contest.type === 'noi' || contest.type === 'ioi') {
      // NOI/IOI 赛制：计算加权总分和最新提交时间
      for (let i in player.score_details) {
        if (!player.score_details[i]) continue;
        
        let score_detail = player.score_details[i];
        let score = null;
        let time = 0;

        if (contest.type === 'ioi') {
          // IOI: 使用最高分
          score = score_detail.best_score;
          time = score_detail.best_time;
        } else if (contest.type === 'noi') {
          // NOI: 使用最新分
          score = score_detail.latest_score;
          time = score_detail.latest_time;
        }

        rankedPlayer.latest = Math.max(rankedPlayer.latest, time);

        if (score != null) {
          let multiplier = this.ranking_params[i] || 1.0;
          let weightedScore = Math.round(score * multiplier);
          rankedPlayer.score += weightedScore;
        }
      }
    } else {
      // ACM 赛制：计算通过题目数和总时间
      for (let i in player.score_details) {
        if (player.score_details[i].accepted) {
          rankedPlayer.score++;
          rankedPlayer.timeSum += (player.score_details[i].accepted_time - contest.start_time) + 
                                 (player.score_details[i].unaccepted_count * 20 * 60);
        }
      }
    }

    // 更新 players 数组
    this.players = players;
    
    // 排序（如果不需要跳过）
    if (!skipSort) {
      await this.sortPlayers(contest, false); // 不保存，因为下面会保存
    }
    
    // 保存到数据库
    await this.save();
  }

  // 批量排序方法
  async sortPlayers(contest, saveToDb = true) {
    if (contest.type === 'noi' || contest.type === 'ioi') {
      this.players.sort((a, b) => {
        if (a.score > b.score) return -1;
        if (b.score > a.score) return 1;
        if (a.latest < b.latest) return -1;
        if (a.latest > b.latest) return 1;
        return 0;
      });
    } else {
      this.players.sort((a, b) => {
        if (a.score > b.score) return -1;
        if (b.score > a.score) return 1;
        if (a.timeSum < b.timeSum) return -1;
        if (a.timeSum > b.timeSum) return 1;
        return 0;
      });
    }

    // 保存到数据库（如果需要）
    if (saveToDb) {
      await this.save();
    }
  }
}
