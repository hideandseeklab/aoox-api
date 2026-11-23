import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Cron, ScheduleModule } from '@nestjs/schedule';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('@nestjs/schedule registration', () => {
  it('calls ScheduleModule.forRoot() exactly once, in app.module.ts', () => {
    const callers = sourceFiles(__dirname).filter((f) =>
      /ScheduleModule\s*\.\s*forRoot(Async)?\s*\(/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(
      callers.map((f) => f.split(sep).join('/').split('/src/')[1]),
    ).toEqual(['app.module.ts']);
  });

  it('shows why: Nest keys each forRoot() by reference, so every extra call duplicates every @Cron', async () => {
    let ticks = 0;
    @Injectable()
    class Svc {
      @Cron('* * * * * *')
      tick() {
        ticks++;
      }
    }
    @Module({ imports: [ScheduleModule.forRoot()], providers: [Svc] })
    class A {}
    @Module({ imports: [ScheduleModule.forRoot()] })
    class B {}
    @Module({ imports: [A, B] })
    class Root {}
    const app = await NestFactory.createApplicationContext(Root, {
      logger: false,
    });
    await app.init();
    await new Promise((r) => setTimeout(r, 1300));
    await app.close();
    // One tick per second would be 1; two copies of the explorer give 2.
    expect(ticks).toBeGreaterThanOrEqual(2);
  });
});
