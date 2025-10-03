import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj, ErrorMessage: any;

import User from "./user";
import Problem from "./problem";
import ContestRanklist from "./contest_ranklist";
import ContestPlayer from "./contest_player";
import JudgeState from "./judge_state";

enum ContestType {
  NOI = "noi",
  IOI = "ioi",
  ICPC = "acm",
  OPEN = "open"
}

@TypeORM.Entity()
export default class Contest extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  subtitle: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  start_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  end_time: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  holder_id: number;

  // type: noi, ioi, acm
  @TypeORM.Column({ nullable: true, type: "enum", enum: ContestType })
  type: ContestType;

  @TypeORM.Column({ nullable: true, type: "text" })
  information: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  problems: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  admins: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  ranklist_id: number;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  hide_statistics: boolean;

  holder?: User;
  ranklist?: ContestRanklist;

  async loadRelationships() {
    this.holder = await User.findById(this.holder_id);
    this.ranklist = await ContestRanklist.findById(this.ranklist_id);
  }

  async isSupervisior(user) {
    return user && (user.is_admin || this.holder_id === user.id || this.admins.split('|').includes(user.id.toString()));
  }

  allowedSeeingOthers() {
    if (this.type === 'acm') return true;
    else return false;
  }

  allowedSeeingScore() { // If not, then the user can only see status
    if (this.type === 'ioi') return true;
    else return false;
  }

  allowedSeeingResult() { // If not, then the user can only see compile progress
    if (this.type === 'ioi' || this.type === 'acm') return true;
    else return false;
  }

  allowedSeeingTestcase() {
    if (this.type === 'ioi') return true;
    return false;
  }

  async getProblems() {
    if (!this.problems) return [];
    return this.problems.split('|').map(x => parseInt(x));
  }

  async setProblemsNoCheck(problemIDs) {
    this.problems = problemIDs.join('|');
  }

  async setProblems(s) {
    let a = [];
    await s.split('|').forEachAsync(async x => {
      let problem = await Problem.findById(x);
      if (!problem) return;
      a.push(x);
    });
    this.problems = a.join('|');
  }

  async newSubmission(judge_state) {
    if (!(judge_state.submit_time >= this.start_time && judge_state.submit_time <= this.end_time)) {
      return;
    }
    let problems = await this.getProblems();
    if (!problems.includes(judge_state.problem_id)) throw new ErrorMessage('当前比赛中无此题目。');

    await syzoj.utils.lock(['Contest::newSubmission', judge_state.user_id], async () => {
      let player = await ContestPlayer.findInContest({
        contest_id: this.id,
        user_id: judge_state.user_id
      });

      if (!player) {
        player = await ContestPlayer.create({
          contest_id: this.id,
          user_id: judge_state.user_id
        });
        await player.save();
      }

      await player.updateScore(judge_state);
      await player.save();

      await this.loadRelationships();
      await this.ranklist.updatePlayer(this, player);
      await this.ranklist.save();
    });
  }

  isRunning(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return now >= this.start_time && now < this.end_time;
  }

  isEnded(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return now >= this.end_time;
  }

  async setType(newType: string) {
    if (!['ioi', 'noi', 'acm', 'open'].includes(newType)) {
      throw new ErrorMessage('无效的赛制类型。');
    }
    this.type = newType as ContestType;
    await this.save();

    await this.loadRelationships();
    let players = this.ranklist.players;

    for (let playerData of players) {
      let player = await ContestPlayer.findById(playerData.player_id);
      if (!player) {
        throw new Error(`找不到 ContestPlayer ${playerData.player_id}，数据异常`);
      }
      await this.ranklist.updatePlayer(this, player, true); // skipSort = true
    }
    
    // 最后进行一次全量排序
    await this.ranklist.sortPlayers(this);
  }

  async reset() {
    // 1. 从数据库重新读取有效提交（比赛时间内的提交）
    let problems = await this.getProblems();
    let where: any = {
      submit_time: TypeORM.Between(this.start_time, this.end_time),
      problem_id: TypeORM.In(problems)
    };

    if (this.type === 'open') {
      // OPEN 比赛统计来源于普通提交（type = 0）
      where.type = 0;
    } else {
      // 其他比赛统计来源于比赛提交（type = 1，type_info = contest_id）
      where.type = 1;
      where.type_info = this.id;
    }

    let validJudgeStates = await JudgeState.find({
      where,
      order: {
        submit_time: 'ASC'
      }
    });

    // 2. 获取所有参与的用户ID
    let userIds = Array.from(new Set(validJudgeStates.map(js => js.user_id)));

    // 3. 删除现有的 ContestPlayer 记录
    await ContestPlayer.delete({
      contest_id: this.id
    });

    // 3.5. 清空 ranklist
    await this.loadRelationships();
    this.ranklist.players = [];
    await this.ranklist.save();

    // 4. 重新创建 ContestPlayer 记录
    let players = [];
    for (let userId of userIds) {
      let player = await ContestPlayer.create({
        contest_id: this.id,
        user_id: userId,
        score_details: {}
      });
      await player.save();
      players.push(player);
    }

    // 5. 按时间顺序处理有效提交，调用 updateScore
    for (let judgeState of validJudgeStates) {
      let player = players.find(p => p.user_id === judgeState.user_id);
      if (player) {
        await player.updateScore(judgeState);
        await player.save();
      }
    }

    // 6. 重新计算 ranklist
    // 注意：loadRelationships 在第195行已经调用过，这里不需要重复调用
    
    // 批量更新所有玩家到 ranklist（使用延迟排序优化）
    for (let player of players) {
      // 重新加载玩家数据以确保 score_details 是最新的
      await player.reload();
      
      // 使用延迟排序选项更新玩家
      await this.ranklist.updatePlayer(this, player, true); // skipSort = true
    }
    
    // 最后进行一次批量排序
    await this.ranklist.sortPlayers(this);
  }
}
