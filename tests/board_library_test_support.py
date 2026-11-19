from playwright.async_api import expect


async def active_board_id(page):
    return await page.evaluate("sessionStorage.getItem('bq-board-current-tab')")


async def read_boards(page, load_records=False):
    return await page.evaluate("""async load => {
      const {openBoardLibrary}=await import('/board-workspace.mjs');
      const library=await openBoardLibrary();
      try {
        if(load)return await Promise.all(library.boards.map(board=>library.load(board.id)));
        return library.boards;
      } finally {library.close();}
    }""", load_records)


async def read_board(page, board_id=None):
    return await page.evaluate("""async id => {
      const {openBoardLibrary}=await import('/board-workspace.mjs');
      const library=await openBoardLibrary();
      try {return await library.load(id??sessionStorage.getItem('bq-board-current-tab'));}
      finally {library.close();}
    }""", board_id)


async def wait_board_saved(page):
    await expect(page.locator('.se-save-badge')).to_contain_text('Lokal gesichert')
