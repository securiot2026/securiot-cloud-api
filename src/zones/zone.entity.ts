import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('zones')
export class Zone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;
}
