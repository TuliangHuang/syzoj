import * as TypeORM from "typeorm";
import Model from "./common";

@TypeORM.Entity()
export default class Quiz extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  description: string;

  // JSON-encoded array: [{ question_id: number, points: number }]
  @TypeORM.Column({ nullable: true, type: "text" })
  items: string;

  async getItems(): Promise<Array<{ question_id: number; points: number }>> {
    try {
      const parsed = JSON.parse(this.items || "[]");
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch (e) {
      return [];
    }
  }

  async setItems(items: Array<{ question_id: number; points: number }>) {
    this.items = JSON.stringify(items || []);
  }

  async getQuestionIds(): Promise<number[]> {
    const items = await this.getItems();
    return items.map(x => parseInt(String(x.question_id)) || 0).filter(Boolean);
  }
}
