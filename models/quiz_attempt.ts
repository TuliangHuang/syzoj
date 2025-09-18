import * as TypeORM from "typeorm";
import Model from "./common";

@TypeORM.Entity()
export default class QuizAttempt extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: false, type: "integer" })
  user_id: number;

  @TypeORM.Column({ nullable: false, type: "integer" })
  quiz_id: number;

  @TypeORM.Column({ nullable: true, type: "json" })
  answers: any;

  @TypeORM.CreateDateColumn({ type: "datetime" })
  created_at: Date;

  @TypeORM.UpdateDateColumn({ type: "datetime" })
  updated_at: Date;

  async getAnswers(): Promise<{ [qid: number]: { answer: string[]; points?: number|null } }> {
    try {
      const val: any = (this as any).answers;
      if (val && typeof val === 'object' && !Array.isArray(val)) return val;
      if (typeof val === 'string') {
        const parsed = JSON.parse(val || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
      }
      return {};
    } catch (e) {
      return {};
    }
  }

  async setAnswers(obj: { [qid: number]: { answer: string[]; points?: number|null } }) {
    (this as any).answers = obj || {};
  }
}

