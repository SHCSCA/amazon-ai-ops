export interface StrictlyClosableBrowserController {
  close(): Promise<void>;
  getPage(): unknown | null;
  getContext(): unknown | null;
}

/**
 * Retains detached controllers until a close attempt both resolves and proves
 * that no page/context residue remains. A failed terminal cleanup can therefore
 * retry the same controllers instead of losing their only Main-owned handles.
 */
export class StrictBrowserControllerCleanup<
  Controller extends StrictlyClosableBrowserController,
> {
  private readonly retained = new Set<Controller>();

  retain(controllers: Iterable<Controller>): void {
    for (const controller of controllers) this.retained.add(controller);
  }

  hasRetainedControllers(): boolean {
    return this.retained.size > 0;
  }

  retainedCount(): number {
    return this.retained.size;
  }

  async closeRetained(): Promise<void> {
    const controllers = [...this.retained];
    const settled = await Promise.allSettled(
      controllers.map((controller) => controller.close()),
    );
    const failures: unknown[] = [];

    controllers.forEach((controller, index) => {
      const result = settled[index];
      if (result?.status === 'rejected') {
        failures.push(result.reason);
        return;
      }

      try {
        if (controller.getPage() !== null || controller.getContext() !== null) {
          failures.push(new Error('pending browser controller retained page/context residue'));
          return;
        }
      } catch (error) {
        failures.push(error);
        return;
      }

      this.retained.delete(controller);
    });

    if (failures.length > 0) {
      throw new AggregateError(failures, 'pending browser controllers did not close strictly');
    }
  }
}
