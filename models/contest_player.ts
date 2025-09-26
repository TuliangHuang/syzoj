import * as TypeORM from "typeorm";
import Model from "./common";

import User from "./user";
import Contest from "./contest";

@TypeORM.Entity()
export default class ContestPlayer extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  contest_id: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  user_id: number;

  @TypeORM.Column({ default: JSON.stringify({}), type: "json" })
  score_details: object;

  @TypeORM.Column({ nullable: true, type: "integer" })
  time_spent: number;

  user?: User;
  contest?: Contest;

  static async findInContest(where) {
    return ContestPlayer.findOne({ where: where });
  }

  async loadRelationships() {
    this.user = await User.findById(this.user_id);
    this.contest = await Contest.findById(this.contest_id);
  }

  // 根据比赛类型获取题目的 judge_id
  async getJudgeId(problem_id) {
    if (!this.score_details || !this.score_details[problem_id]) {
      return 0;
    }
    
    // 确保 contest 关系已加载
    if (!this.contest) {
      await this.loadRelationships();
    }
    
    let score_detail = this.score_details[problem_id];
    
    if (this.contest.type === 'ioi' && score_detail.best_judge_id > 0) {
      return score_detail.best_judge_id;
    } else if (this.contest.type === 'noi' && score_detail.latest_judge_id > 0) {
      return score_detail.latest_judge_id;
    } else if (this.contest.type === 'acm' && score_detail.accepted) {
      return score_detail.first_accepted_judge_id;
    }
    
    return 0;
  }

  async updateScore(judge_state) {
    if (judge_state.pending) return;

    // 确保 score_details 存在
    if (!this.score_details) {
      this.score_details = {};
    }

    // 初始化题目数据结构
    if (!this.score_details[judge_state.problem_id]) {
      this.score_details[judge_state.problem_id] = {
        // IOI 相关
        best_score: null,          // IOI: 最高分数
        best_judge_id: 0,          // IOI: 最高分对应的评测ID
        best_time: 0,              // IOI: 最高分提交时间
        
        // NOI 相关  
        latest_score: null,        // NOI: 最新分数
        latest_judge_id: 0,        // NOI: 最新评测ID
        latest_time: 0,            // NOI: 最新提交时间
        
        // ACM 相关
        accepted: false,            // ACM: 是否通过
        accepted_time: 0,           // ACM: 通过时间
        first_accepted_judge_id: 0, // ACM: 首次通过的评测ID
        unaccepted_count: 0,        // ACM: 未通过次数
        
        // 通用
        submissions: {}            // 所有提交记录
      };
    }

    let problemData = this.score_details[judge_state.problem_id];
    let isAccepted = judge_state.status === 'Accepted';
    let isCompiled = judge_state.score != null;

    // 添加提交记录
    problemData.submissions[judge_state.id] = {
      judge_id: judge_state.id,
      score: judge_state.score,
      accepted: isAccepted,
      compiled: isCompiled,
      time: judge_state.submit_time
    };

    // 1. 更新 NOI 相关属性：最新提交（如果提交时间更晚）
    if (problemData.latest_time == null || judge_state.submit_time >= problemData.latest_time) {
      problemData.latest_score = judge_state.score;
      problemData.latest_judge_id = judge_state.id;
      problemData.latest_time = judge_state.submit_time;
    }

    // 2. 更新 IOI 相关属性：最高分（如果当前分数更高）
    if (judge_state.score != null) {
      if (problemData.best_score == null || judge_state.score >= problemData.best_score) {
        problemData.best_score = judge_state.score;
        problemData.best_judge_id = judge_state.id;
        problemData.best_time = judge_state.submit_time;
      }
    }

    // 3. 更新 ACM 相关属性
    if (isAccepted) {
      // 如果这次通过了，更新通过状态
      if (!problemData.accepted || judge_state.submit_time < problemData.accepted_time) {
        problemData.accepted = true;
        problemData.accepted_time = judge_state.submit_time;
        problemData.first_accepted_judge_id = judge_state.id;
      }
    } else if (isCompiled) {
      // 如果这次编译了但没通过，增加未通过次数
      problemData.unaccepted_count++;
    }
  }
}
