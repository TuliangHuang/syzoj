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

  @TypeORM.Column({ nullable: true, type: "json" })
  items: any;

  async getItems(): Promise<Array<{ question_id: number; points: number }>> {
    try {
      const val: any = (this as any).items;
      if (Array.isArray(val)) return val as any;
      if (typeof val === 'string') {
        const parsed = JSON.parse(val || '[]');
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  async setItems(items: Array<{ question_id: number; points: number }>) {
    // Assign directly; mapper will handle json or text depending on column type
    (this as any).items = items || [] as any;
  }

  async getQuestionIds(): Promise<number[]> {
    const items = await this.getItems();
    return items.map(x => parseInt(String(x.question_id)) || 0).filter(Boolean);
  }
}
